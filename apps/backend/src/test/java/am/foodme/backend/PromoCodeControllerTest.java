package am.foodme.backend;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.HashMap;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * KAN-11 promo code pricing (POST /api/order/promo-code). Placing an order with a
 * code lives in OrderControllerTest, because it consumes order_number_seq.
 * Chef 1 (test data): delivery 700 AMD, free from 8,000 AMD.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PromoCodeControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private ResultActions quote(String code, double subtotal, String deliveryMethod) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("code", code);
        body.put("chefId", 1);
        body.put("subtotal", subtotal);
        body.put("deliveryMethod", deliveryMethod);
        return mockMvc.perform(post("/api/order/promo-code")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body)));
    }

    @Test
    void validCode_takeaway_discountsSubtotal() throws Exception {
        quote("SAVE10", 4000, "TAKEAWAY")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applies").value(true))
                .andExpect(jsonPath("$.code").value("SAVE10"))
                .andExpect(jsonPath("$.percentOff").value(10))
                .andExpect(jsonPath("$.subtotal").value(4000.0))
                .andExpect(jsonPath("$.deliveryPrice").value(0.0))
                .andExpect(jsonPath("$.discount").value(400.0))
                .andExpect(jsonPath("$.total").value(3600.0))
                .andExpect(jsonPath("$.reason").doesNotExist());
    }

    @Test
    void validCode_delivery_returnsDeliveryFeeAndNewTotal() throws Exception {
        // Discount is taken off the subtotal (AC-2); the delivery fee is added on top.
        quote("SAVE10", 4000, "DELIVERY")
                .andExpect(jsonPath("$.applies").value(true))
                .andExpect(jsonPath("$.deliveryPrice").value(700.0))
                .andExpect(jsonPath("$.discount").value(400.0))
                .andExpect(jsonPath("$.total").value(4300.0));
    }

    // KAN-11 Q-3 (answered by the product owner): exact match only, so anything but the
    // code as written is "Code not found". Fails until KAN-20 (the service trims and
    // upper-cases the code) is fixed; matches e2e KAN-11-TC-07.
    @Tag("known-bug") // KAN-20, still fails by design; excluded from mutation testing only
    @Test
    void code_isExactMatchOnly() throws Exception {
        quote("  treat15 ", 10000, "TAKEAWAY")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applies").value(false))
                .andExpect(jsonPath("$.reason").value("NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Code not found"))
                .andExpect(jsonPath("$.discount").value(0.0))
                .andExpect(jsonPath("$.total").value(10000.0));
    }

    // Boundary values around each code's minimum order amount (AC-3).
    @ParameterizedTest(name = "{0} at subtotal {1} -> applies={2}, missing={3}")
    @CsvSource({
            "SAVE10, 3000, true, ",
            "SAVE10, 2999.99, false, 0.01",
            "SAVE10, 2000, false, 1000",
            "TREAT15, 8000, true, ",
            "TREAT15, 7999, false, 1",
    })
    void minimumOrderAmount_boundaries(String code, double subtotal, boolean applies, Double missing) throws Exception {
        ResultActions result = quote(code, subtotal, "TAKEAWAY")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applies").value(applies));
        if (applies) {
            result.andExpect(jsonPath("$.missingAmount").doesNotExist());
        } else {
            result.andExpect(jsonPath("$.reason").value("BELOW_MINIMUM"))
                    .andExpect(jsonPath("$.missingAmount").value(missing))
                    .andExpect(jsonPath("$.discount").value(0.0))
                    .andExpect(jsonPath("$.total").value(subtotal));
        }
    }

    @Test
    void belowMinimum_messageStatesMissingAmount() throws Exception {
        quote("SAVE10", 2000, "TAKEAWAY")
                .andExpect(jsonPath("$.message").value("Add 1,000 AMD more to use this code"));
    }

    @Test
    void expiredCode_isRejected() throws Exception {
        quote("OLD15", 10000, "TAKEAWAY")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applies").value(false))
                .andExpect(jsonPath("$.reason").value("EXPIRED"))
                .andExpect(jsonPath("$.message").value("This code has expired"))
                .andExpect(jsonPath("$.discount").value(0.0))
                .andExpect(jsonPath("$.total").value(10000.0));
    }

    @Test
    void unknownCode_isRejected() throws Exception {
        quote("NOPE99", 10000, "TAKEAWAY")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applies").value(false))
                .andExpect(jsonPath("$.reason").value("NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Code not found"));
    }

    @Test
    void blankCode_isTreatedAsNotFound() throws Exception {
        quote("   ", 10000, "TAKEAWAY")
                .andExpect(jsonPath("$.applies").value(false))
                .andExpect(jsonPath("$.reason").value("NOT_FOUND"));
    }
}

package am.foodme.backend;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class OrderControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private final AtomicInteger customerSeq = new AtomicInteger();

    private String customerToken() throws Exception {
        String email = "order-test-" + customerSeq.incrementAndGet() + "-" + UUID.randomUUID() + "@example.com";
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "fullName", "Ann",
                                "email", email,
                                "phoneNumber", "+37491234567",
                                "password", "secret123"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    private String cashOrderPayload() throws Exception {
        Map<String, Object> body = Map.of(
                "chefId", 1,
                "receiverName", "Ann",
                "receiverPhoneNumber", "+37491234567",
                "receiverEmail", "ann@example.com",
                "paymentType", "CASH",
                "deliveryMethod", "TAKEAWAY",
                "note", "ring twice",
                "createOrderDishes", List.of(Map.of("dishId", 1, "quantity", 2))
        );
        return objectMapper.writeValueAsString(body);
    }

    @Order(3)
    @Test
    void createOrder_cashPayment_succeeds() throws Exception {
        String token = customerToken();
        String response = mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cashOrderPayload()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NEW"))
                .andExpect(jsonPath("$.number").exists())
                .andReturn().getResponse().getContentAsString();
        String number = objectMapper.readTree(response).get("number").asText();

        mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(1))
                .andExpect(jsonPath("$.list[0].number").value(number));
    }

    @Test
    void createOrder_withoutToken_unauthorized() throws Exception {
        mockMvc.perform(post("/api/order").contentType(MediaType.APPLICATION_JSON).content(cashOrderPayload()))
                .andExpect(status().isUnauthorized());
    }

    @Order(4)
    @Test
    void createOrder_nonCashPayment_rejectedWithBadRequest() throws Exception {
        Map<String, Object> body = Map.of(
                "chefId", 1,
                "receiverName", "Ann",
                "receiverPhoneNumber", "+37491234567",
                "receiverEmail", "ann@example.com",
                "paymentType", "CARD",
                "deliveryMethod", "TAKEAWAY",
                "createOrderDishes", List.of(Map.of("dishId", 1, "quantity", 1))
        );
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + customerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Only CASH payment is supported"));
    }

    // FM-FLAKE-02
    @Order(1)
    @Test
    void createOrder_firstOrderGetsNumber100001() throws Exception {
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + customerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cashOrderPayload()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value("FM-100001"));
    }

    // FM-FLAKE-02
    @Order(2)
    @Test
    void getOrderByNumber_firstOrderIsFm100001() throws Exception {
        mockMvc.perform(post("/api/order")
                .header("Authorization", "Bearer " + customerToken())
                .contentType(MediaType.APPLICATION_JSON)
                .content(cashOrderPayload()));

        mockMvc.perform(get("/api/order/number/FM-100001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value("FM-100001"));
    }

    // FM-FLAKE-04
    @Order(5)
    @Test
    void createOrder_createdAtFallsOnToday() throws Exception {
        String response = mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + customerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cashOrderPayload()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String number = objectMapper.readTree(response).get("number").asText();

        String orderResponse = mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String createdAt = objectMapper.readTree(orderResponse).get("createdAt").asText();

        assertTrue(createdAt.startsWith(LocalDate.now().toString()));
    }

    // CHK-10: chef 1 (marta-k, see data.sql) has free_delivery_from = 8000.0.
    // Delivery should be free when subtotal exactly equals that threshold, not
    // only when it exceeds it.
    @Test
    void deliveryPrice_subtotalEqualsFreeThreshold_isFree() throws Exception {
        Map<String, Object> body = Map.of(
                "chefId", 1,
                "subtotal", 8000.0,
                "deliveryMethod", "DELIVERY"
        );
        mockMvc.perform(post("/api/order/delivery-price")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deliveryPrice").value(0.0));
    }

    // CHK-11: dish 5 (see data.sql) belongs to chef 2 and is priced 1500.33
    // specifically to catch truncation - quantity 2 should total 3000.66, not
    // 3000. Chef 2 (not chef 1) deliberately, so it doesn't bump chef 1's
    // active-dish count and break DishControllerTest's exact-count assertion.
    @Order(6)
    @Test
    void createOrder_fractionalDishPrice_subtotalKeepsCents() throws Exception {
        Map<String, Object> body = Map.of(
                "chefId", 2,
                "receiverName", "Ann",
                "receiverPhoneNumber", "+37491234567",
                "receiverEmail", "ann@example.com",
                "paymentType", "CASH",
                "deliveryMethod", "TAKEAWAY",
                "createOrderDishes", List.of(Map.of("dishId", 5, "quantity", 2))
        );
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + customerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalPrice").value(3000.66));
    }

    // CHK-12: dish 3 belongs to chef 2 (ararat-grill, see data.sql), not chef 1.
    // Ordering it under chefId=1 should be rejected, not silently accepted.
    @Order(7)
    @Test
    void createOrder_dishFromDifferentChef_isRejected() throws Exception {
        Map<String, Object> body = Map.of(
                "chefId", 1,
                "receiverName", "Ann",
                "receiverPhoneNumber", "+37491234567",
                "receiverEmail", "ann@example.com",
                "paymentType", "CASH",
                "deliveryMethod", "TAKEAWAY",
                "createOrderDishes", List.of(Map.of("dishId", 3, "quantity", 1))
        );
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + customerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().is4xxClientError());
    }

    // CHK-14: a dish id that doesn't exist at all should 404, not be silently
    // skipped or crash with a 500.
    @Order(8)
    @Test
    void createOrder_nonexistentDish_returns404() throws Exception {
        Map<String, Object> body = Map.of(
                "chefId", 1,
                "receiverName", "Ann",
                "receiverPhoneNumber", "+37491234567",
                "receiverEmail", "ann@example.com",
                "paymentType", "CASH",
                "deliveryMethod", "TAKEAWAY",
                "createOrderDishes", List.of(Map.of("dishId", 999999, "quantity", 1))
        );
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + customerToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isNotFound());
    }
}

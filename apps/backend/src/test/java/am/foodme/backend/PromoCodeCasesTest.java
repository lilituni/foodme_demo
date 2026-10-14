package am.foodme.backend;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.transaction.AfterTransaction;
import org.springframework.test.context.transaction.BeforeTransaction;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * KAN-11 promo codes: tests generated from the approved API test cases
 * (functional-testing workflow, step 06). The case in runs/KAN-11/spec.yaml is
 * the spec; each assertion is commented with the expected fact it checks.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional // rolls back the case data and orders, so other tests on the shared H2 DB (e.g. ChefControllerTest counting active chefs) never see them
class PromoCodeCasesTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbc;

    private long sequenceBefore;

    /**
     * The rollback doesn't undo foodme.order_number_seq, and OrderControllerTest assumes the
     * first API order is FM-100001, so the sequence is restored after each test. This runs
     * outside the test transaction: ALTER SEQUENCE is DDL and would commit it in H2.
     */
    @BeforeTransaction
    void rememberSequence() {
        sequenceBefore = jdbc.queryForObject(
                "SELECT BASE_VALUE FROM INFORMATION_SCHEMA.SEQUENCES "
                        + "WHERE SEQUENCE_SCHEMA = 'FOODME' AND SEQUENCE_NAME = 'ORDER_NUMBER_SEQ'",
                Long.class);
    }

    @AfterTransaction
    void restoreSequence() {
        jdbc.execute("ALTER SEQUENCE foodme.order_number_seq RESTART WITH " + sequenceBefore);
    }

    /**
     * The case's data lives on the SUT (chef 17 Verona, dishes 116 and 117); the H2
     * test database only seeds chefs 1-3, so the same ids and prices are added here.
     */
    @BeforeEach
    void caseData() {
        jdbc.update("""
                MERGE INTO foodme.chef (id, username, phone_number, email, avatar_url, banner_url, status,
                    full_name_en, full_name_am, full_name_ru, description_en, description_am, description_ru,
                    kitchen_en, kitchen_am, kitchen_ru, rating, platform_fee, delivery_price, free_delivery_from, priority_index)
                KEY (id) VALUES
                (17, 'verona', '+37493000017', 'verona@foodme.am', '/img/chef/17-avatar.jpg', '/img/chef/17-banner.jpg', 'ACTIVE',
                 'Verona', 'Verona', 'Verona', 'Bakery.', 'Bakery.', 'Bakery.',
                 'Bakery', 'Bakery', 'Bakery', 4.5, 0.12, 500.0, 5000.0, 3)
                """);
        jdbc.update("""
                MERGE INTO foodme.dish (id, name_en, name_am, name_ru, description_en, price, url, portion_en, portion_am, portion_ru,
                    status, minimum_order_count, priority_index, chef_id, dish_tag_id)
                KEY (id) VALUES
                (116, 'Quiche with mushrooms', 'Quiche with mushrooms', 'Quiche with mushrooms', 'Quiche.', 1200.0, '/img/dish/116.jpg', '1', '1', '1', 'ACTIVE', 1, 0, 17, 1),
                (117, 'Pie with beans', 'Pie with beans', 'Pie with beans', 'Pie.', 550.0, '/img/dish/117.jpg', '1', '1', '1', 'ACTIVE', 1, 1, 17, 1)
                """);
    }

    private String customerToken() throws Exception {
        String email = "stlc-kan11-" + UUID.randomUUID() + "@example.com";
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "fullName", "STLC Tester",
                                "email", email,
                                "phoneNumber", "+37491000000",
                                "password", "secret123"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    /** The case's request body: B-2950 = 2 x Quiche with mushrooms + 1 x Pie with beans, chef 17, Takeaway, cash. */
    private String b2950Order(String note, String promoCode) throws Exception {
        Map<String, Object> body = new HashMap<>(Map.of(
                "chefId", 17,
                "receiverName", "STLC Tester",
                "receiverPhoneNumber", "+37491000000",
                "receiverEmail", "stlc-kan11@example.com",
                "paymentType", "CASH",
                "deliveryMethod", "TAKEAWAY",
                "note", note,
                "createOrderDishes", List.of(
                        Map.of("dishId", 116, "quantity", 2),
                        Map.of("dishId", 117, "quantity", 1))
        ));
        if (promoCode != null) {
            body.put("promoCode", promoCode);
        }
        return objectMapper.writeValueAsString(body);
    }

    private int orderCount(String token) throws Exception {
        String response = mockMvc.perform(get("/api/customer/orders")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("count").asInt();
    }

    @Test
    @DisplayName("KAN-11-TC-14 The server re-check at order placement rejects SAVE10 below its minimum")
    void tc14_save10BelowMinimumAtPlacement_orderRefused() throws Exception {
        String token = customerToken();

        // Step 1 - control: the same POST without "promoCode".
        // expected[1]: the order without a code is accepted
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(b2950Order("STLC KAN-11 TC-14 control", null)))
                .andExpect(status().isOk());

        // Step 2: note the number of orders.
        int countAfterControl = orderCount(token);

        // Step 3: the case's POST with "promoCode": "SAVE10".
        // expected[2]: the order is not placed, the POST is refused with the AC-3 reason
        // (2,950 AMD subtotal, SAVE10 minimum 3,000 AMD)
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(b2950Order("STLC KAN-11 TC-14", "SAVE10")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Add 50 AMD more to use this code"));

        // Step 4. expected[3]: the order count is the same as after the control order
        assertEquals(countAfterControl, orderCount(token));
    }
}

package am.foodme.backend;

import am.foodme.backend.model.OrderDish;
import am.foodme.backend.repository.ChefRepository;
import am.foodme.backend.repository.CustomerRepository;
import am.foodme.backend.repository.OrderRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.hamcrest.Matchers.containsInAnyOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
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

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private ChefRepository chefRepository;

    @Autowired
    private CustomerRepository customerRepository;

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

    @Test
    void createOrder_noteLongerThan2000_isRejectedWith400() throws Exception {
        String token = customerToken();
        Map<String, Object> body = new HashMap<>(objectMapper.readValue(cashOrderPayload(), Map.class));
        body.put("note", "x".repeat(2001));
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
    }

    @Order(3)
    @Test
    void createOrder_cashPayment_succeeds()throws Exception {
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
    @Tag("known-bug") // seeded bug, still fails by design; excluded from mutation testing only
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
    @Tag("known-bug") // seeded bug, still fails by design; excluded from mutation testing only
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
    @Tag("known-bug") // seeded bug, still fails by design; excluded from mutation testing only
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

    /**
     * KAN-10/KAN-15: order history carries what "Order again" needs to rebuild the
     * basket. Like PlacingWithPromoCode below, these tests delete what they placed and
     * restart order_number_seq afterwards, so they don't depend on running order.
     */
    @Nested
    class OrderHistoryForReorder {

        @Autowired
        private JdbcTemplate jdbc;

        private final List<String> placedNumbers = new ArrayList<>();
        private long sequenceBefore;

        @BeforeEach
        void rememberSequence() {
            sequenceBefore = jdbc.queryForObject(
                    "SELECT BASE_VALUE FROM INFORMATION_SCHEMA.SEQUENCES "
                            + "WHERE SEQUENCE_SCHEMA = 'FOODME' AND SEQUENCE_NAME = 'ORDER_NUMBER_SEQ'",
                    Long.class);
        }

        @AfterEach
        void removePlacedOrders() {
            placedNumbers.forEach(number -> orderRepository.findByNumber(number).ifPresent(orderRepository::delete));
            jdbc.execute("ALTER SEQUENCE foodme.order_number_seq RESTART WITH " + sequenceBefore);
        }

        private void placeOrder(String token, List<Map<String, Object>> dishes) throws Exception {
            Map<String, Object> body = Map.of(
                    "chefId", 1,
                    "receiverName", "Ann",
                    "receiverPhoneNumber", "+37491234567",
                    "receiverEmail", "ann@example.com",
                    "paymentType", "CASH",
                    "deliveryMethod", "TAKEAWAY",
                    "createOrderDishes", dishes
            );
            String response = mockMvc.perform(post("/api/order")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(body)))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            placedNumbers.add(objectMapper.readTree(response).get("number").asText());
        }

        @Test
        void orderHistory_afterPlacingOrder_showsDishReferencePerLineAndChef() throws Exception {
            String token = customerToken();
            placeOrder(token, List.of(
                    Map.of("dishId", 2, "quantity", 1),
                    Map.of("dishId", 1, "quantity", 3)));

            mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.list[0].chefId").value(1))
                    .andExpect(jsonPath("$.list[0].orderDishList.length()").value(2))
                    .andExpect(jsonPath("$.list[0].orderDishList[?(@.nameEn == 'Khashlama')].dishId").value(2))
                    .andExpect(jsonPath("$.list[0].orderDishList[?(@.nameEn == 'Khashlama')].quantity").value(1))
                    .andExpect(jsonPath("$.list[0].orderDishList[?(@.nameEn == 'Lavash Wrap')].dishId").value(1))
                    .andExpect(jsonPath("$.list[0].orderDishList[?(@.nameEn == 'Lavash Wrap')].quantity").value(3));
        }

        // The order_dish_addition id comes from a sequence (IDENTITY failed on Postgres for
        // every order with an extra). Two extras on one line take two ids from it. Dish
        // additions 1 (Extra herbs) and 2 (Extra cheese) on Khashlama are in data.sql.
        @Test
        void orderHistory_orderWithTwoExtras_savesAndReturnsBoth() throws Exception {
            String token = customerToken();
            placeOrder(token, List.of(Map.of("dishId", 2, "quantity", 2,
                    "additions", List.of(Map.of("additionId", 1), Map.of("additionId", 2)))));

            mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.list[0].orderDishList[0].dishId").value(2))
                    .andExpect(jsonPath("$.list[0].orderDishList[0].quantity").value(2))
                    .andExpect(jsonPath("$.list[0].orderDishList[0].additions.length()").value(2))
                    .andExpect(jsonPath("$.list[0].orderDishList[0].additions[*].nameEn",
                            containsInAnyOrder("Extra herbs", "Extra cheese")))
                    .andExpect(jsonPath("$.list[0].orderDishList[0].additions[0].id").isNumber())
                    .andExpect(jsonPath("$.list[0].orderDishList[0].additions[1].id").isNumber());
        }

        // The dish references are only for the order's own customer: another customer's
        // history doesn't list the order at all.
        @Test
        void orderHistory_ofAnotherCustomer_doesNotListTheOrder() throws Exception {
            placeOrder(customerToken(), List.of(Map.of("dishId", 2, "quantity", 1)));
            String placed = placedNumbers.get(0);

            mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + customerToken()))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.list[?(@.number == '" + placed + "')]").isEmpty());
        }

        // KAN-15: a legacy line whose dish can't be traced is still listed, just without the reference.
        @Test
        void orderHistory_legacyLineWithoutDish_isShownWithoutReference() throws Exception {
            String token = customerToken();
            String email = objectMapper.readTree(mockMvc.perform(get("/api/customer/me")
                            .header("Authorization", "Bearer " + token))
                    .andReturn().getResponse().getContentAsString()).get("email").asText();

            am.foodme.backend.model.Order order = new am.foodme.backend.model.Order();
            order.setNumber("LG-" + UUID.randomUUID().toString().substring(0, 8));
            order.setStatus("DELIVERED");
            order.setChef(chefRepository.findById(1L).orElseThrow());
            order.setCustomer(customerRepository.findByEmail(email).orElseThrow());
            order.setReceiverName("Ann");
            order.setPaymentType("CASH");
            order.setDeliveryMethod("TAKEAWAY");
            order.setTotalPrice(2000.0);
            order.setDeliveryPrice(0.0);
            order.setCreatedAt(java.time.LocalDateTime.now());
            OrderDish line = new OrderDish();
            line.setOrder(order);
            line.setNameEn("Retired Dish");
            line.setPrice(2000.0);
            line.setQuantity(1);
            order.setOrderDishList(List.of(line));
            orderRepository.save(order);
            placedNumbers.add(order.getNumber());

            mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.list[0].orderDishList[0].nameEn").value("Retired Dish"))
                    .andExpect(jsonPath("$.list[0].orderDishList[0].quantity").value(1))
                    .andExpect(jsonPath("$.list[0].orderDishList[0].dishId").doesNotExist());
        }
    }

    /**
     * KAN-11: placing an order with a promo code. Placing an order consumes
     * order_number_seq, and the FM-FLAKE-02 cases above expect the first API order to be
     * FM-100001, so these tests delete what they placed and restart the sequence after
     * each test instead of relying on running after them.
     */
    @Nested
    class PlacingWithPromoCode {

        @Autowired
        private JdbcTemplate jdbc;

        @Autowired
        private OrderRepository orderRepository;

        private final List<String> placedNumbers = new ArrayList<>();
        private long sequenceBefore;

        @BeforeEach
        void rememberSequence() {
            sequenceBefore = jdbc.queryForObject(
                    "SELECT BASE_VALUE FROM INFORMATION_SCHEMA.SEQUENCES "
                            + "WHERE SEQUENCE_SCHEMA = 'FOODME' AND SEQUENCE_NAME = 'ORDER_NUMBER_SEQ'",
                    Long.class);
        }

        @AfterEach
        void removePlacedOrders() {
            placedNumbers.forEach(number -> orderRepository.findByNumber(number).ifPresent(orderRepository::delete));
            jdbc.execute("ALTER SEQUENCE foodme.order_number_seq RESTART WITH " + sequenceBefore);
        }

        private Map<String, Object> promoOrder(int quantity, String promoCode) {
            Map<String, Object> body = new HashMap<>(Map.of(
                    "chefId", 1,
                    "receiverName", "Ann",
                    "receiverPhoneNumber", "+37491234567",
                    "receiverEmail", "ann@example.com",
                    "paymentType", "CASH",
                    "deliveryMethod", "TAKEAWAY",
                    "createOrderDishes", List.of(Map.of("dishId", 1, "quantity", quantity))
            ));
            body.put("promoCode", promoCode);
            return body;
        }

        private ResultActions placePromoOrder(String token, int quantity, String promoCode) throws Exception {
            ResultActions result = mockMvc.perform(post("/api/order")
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(promoOrder(quantity, promoCode))));
            JsonNode body = objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
            if (body.hasNonNull("number")) {
                placedNumbers.add(body.get("number").asText());
            }
            return result;
        }

        private void expectNoOrders(String token) throws Exception {
            mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.count").value(0));
        }

        @Test
        void createOrder_withValidPromoCode_savesCodeAndDiscount() throws Exception {
            // 2 x Lavash Wrap (1,800) = 3,600 subtotal; SAVE10 -> 360 off.
            placePromoOrder(customerToken(), 2, "SAVE10")
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalPrice").value(3240.0));
            String number = placedNumbers.get(0);

            mockMvc.perform(get("/api/order/number/" + number))
                    .andExpect(jsonPath("$.promoCode").value("SAVE10"))
                    .andExpect(jsonPath("$.discount").value(360.0))
                    .andExpect(jsonPath("$.totalPrice").value(3240.0));
        }

        @Test
        void createOrder_withPromoCodeBelowMinimum_isRejectedAndNotSaved() throws Exception {
            String token = customerToken();
            placePromoOrder(token, 1, "SAVE10")
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Add 1,200 AMD more to use this code"));

            expectNoOrders(token);
        }

        @Test
        void createOrder_withExpiredPromoCode_isRejectedAndNotSaved() throws Exception {
            String token = customerToken();
            placePromoOrder(token, 5, "OLD15")
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("This code has expired"));

            expectNoOrders(token);
        }

        @Test
        void createOrder_withUnknownPromoCode_isRejectedAndNotSaved() throws Exception {
            String token = customerToken();
            placePromoOrder(token, 5, "NOPE99")
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Code not found"));

            expectNoOrders(token);
        }

        // KAN-11 Q-3: exact match only, so a near-match is "Code not found" at placement
        // too. Fails until KAN-20 (the service trims and upper-cases the code) is fixed.
        @Tag("known-bug") // KAN-20, still fails by design; excluded from mutation testing only
        @Test
        void createOrder_withNearMatchPromoCode_isRejectedAndNotSaved() throws Exception {
            String token = customerToken();
            placePromoOrder(token, 2, " save10 ")
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Code not found"));

            expectNoOrders(token);
        }

        @Test
        void createOrder_withoutPromoCode_hasNoDiscount() throws Exception {
            placePromoOrder(customerToken(), 2, null)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalPrice").value(3600.0));
            String number = placedNumbers.get(0);

            mockMvc.perform(get("/api/order/number/" + number))
                    .andExpect(jsonPath("$.promoCode").doesNotExist())
                    .andExpect(jsonPath("$.discount").doesNotExist());
        }
    }
}

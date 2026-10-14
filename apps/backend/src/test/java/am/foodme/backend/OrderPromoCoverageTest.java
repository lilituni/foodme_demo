package am.foodme.backend;

import am.foodme.backend.repository.OrderRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Covers OrderService / PromoCodeService paths the promo-code tests don't reach:
 * delivery-price rules, not-found lookups, the delivery address on an order, the
 * placed-orders counter, and the total on a rejected promo quote.
 *
 * Chef 1 (data.sql): delivery_price 700.0, free_delivery_from 8000.0; dish 1 costs 1800.0.
 * The exact-threshold case (subtotal == 8000) is FM-BUG-03 and stays in OrderControllerTest.
 *
 * Placing orders consumes foodme.order_number_seq, and OrderControllerTest assumes the first
 * API order is FM-100001, so placed orders are deleted and the sequence restarted afterwards.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderPromoCoverageTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private MeterRegistry meterRegistry;

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

    private String registerCustomer() throws Exception {
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "fullName", "Coverage Tester",
                                "email", "coverage-" + UUID.randomUUID() + "@example.com",
                                "phoneNumber", "+37491000000",
                                "password", "secret123"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    private Map<String, Object> orderBody(long chefId, String deliveryMethod, Map<String, Object> address) {
        Map<String, Object> body = new HashMap<>();
        body.put("chefId", chefId);
        body.put("receiverName", "Coverage Tester");
        body.put("receiverPhoneNumber", "+37491000000");
        body.put("paymentType", "CASH");
        body.put("deliveryMethod", deliveryMethod);
        body.put("createOrderDishes", List.of(Map.of("dishId", 1, "quantity", 1)));
        if (address != null) {
            body.put("addressDto", address);
        }
        return body;
    }

    private String placeOrder(String token, String deliveryMethod, Map<String, Object> address) throws Exception {
        String response = mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(orderBody(1, deliveryMethod, address))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String number = objectMapper.readTree(response).get("number").asText();
        placedNumbers.add(number);
        return number;
    }

    private JsonNode orderByNumber(String number) throws Exception {
        String response = mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response);
    }

    private double placedCount() {
        Counter counter = meterRegistry.find("foodme.orders").counter();
        return counter == null ? 0.0 : counter.count();
    }

    private double promoCount(String code) {
        Counter counter = meterRegistry.find("foodme.orders.promo").tag("code", code).counter();
        return counter == null ? 0.0 : counter.count();
    }

    /** Places a chef 1 order of {@code quantity} x {@code dishId} with a promo code; returns the placed order. */
    private JsonNode placePromoOrder(String token, long dishId, int quantity, String deliveryMethod, String code)
            throws Exception {
        Map<String, Object> body = orderBody(1, deliveryMethod,
                "DELIVERY".equals(deliveryMethod) ? Map.of("city", "Yerevan", "street", "Abovyan", "building", "12") : null);
        body.put("createOrderDishes", List.of(Map.of("dishId", dishId, "quantity", quantity)));
        body.put("promoCode", code);
        String response = mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String number = objectMapper.readTree(response).get("number").asText();
        placedNumbers.add(number);
        return orderByNumber(number);
    }

    private void deliveryPrice(Map<String, Object> body, double expectedPrice) throws Exception {
        mockMvc.perform(post("/api/order/delivery-price")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deliveryPrice").value(expectedPrice))
                .andExpect(jsonPath("$.freeDeliveryFrom").value(8000.0));
    }

    @Test
    void deliveryPrice_unknownChef_isNotFound() throws Exception {
        mockMvc.perform(post("/api/order/delivery-price")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "chefId", 999999, "subtotal", 1000.0, "deliveryMethod", "DELIVERY"))))
                .andExpect(status().isNotFound());
    }

    @Test
    void deliveryPrice_takeaway_isFree() throws Exception {
        deliveryPrice(Map.of("chefId", 1, "subtotal", 1000.0, "deliveryMethod", "TAKEAWAY"), 0.0);
    }

    @Test
    void deliveryPrice_noSubtotal_chargesChefPrice() throws Exception {
        deliveryPrice(Map.of("chefId", 1, "deliveryMethod", "DELIVERY"), 700.0);
    }

    @Test
    void deliveryPrice_belowFreeThreshold_chargesChefPrice() throws Exception {
        deliveryPrice(Map.of("chefId", 1, "subtotal", 7999.0, "deliveryMethod", "DELIVERY"), 700.0);
    }

    @Test
    void deliveryPrice_aboveFreeThreshold_isFree() throws Exception {
        deliveryPrice(Map.of("chefId", 1, "subtotal", 8001.0, "deliveryMethod", "DELIVERY"), 0.0);
    }

    @Test
    void promoQuote_unknownCode_keepsUndiscountedTotal() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("code", "NOPE42");
        body.put("chefId", 1);
        body.put("subtotal", 1000.0);
        body.put("deliveryMethod", "DELIVERY");
        mockMvc.perform(post("/api/order/promo-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applies").value(false))
                .andExpect(jsonPath("$.discount").value(0.0))
                .andExpect(jsonPath("$.total").value(1700.0));
    }

    @Test
    void promoQuote_nullCode_isNotFoundAndKeepsTotal() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("code", null);
        body.put("chefId", 1);
        body.put("subtotal", 3600.0);
        body.put("deliveryMethod", "DELIVERY");
        mockMvc.perform(post("/api/order/promo-code")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.applies").value(false))
                .andExpect(jsonPath("$.reason").value("NOT_FOUND"))
                .andExpect(jsonPath("$.discount").value(0.0))
                .andExpect(jsonPath("$.total").value(4300.0));
    }

    @Test
    void createOrder_deliveryWithSave10_discountsSubtotalOnly() throws Exception {
        String token = registerCustomer();
        double promoBefore = promoCount("SAVE10");

        // 2 x Lavash Wrap = 3,600; SAVE10 takes 360 off the subtotal; delivery 700 is not discounted.
        JsonNode order = placePromoOrder(token, 1, 2, "DELIVERY", "SAVE10");

        assertThat(order.get("promoCode").asText()).isEqualTo("SAVE10");
        assertThat(order.get("discount").asDouble()).isEqualTo(360.0);
        assertThat(order.get("deliveryPrice").asDouble()).isEqualTo(700.0);
        assertThat(order.get("totalPrice").asDouble()).isEqualTo(3940.0);
        assertThat(promoCount("SAVE10")).isEqualTo(promoBefore + 1);
    }

    @Test
    void createOrder_deliveryWithTreat15AboveFreeThreshold_hasNoDeliveryFee() throws Exception {
        String token = registerCustomer();

        // 2 x Khashlama = 8,400 > 8,000, so delivery is free; TREAT15 takes 1,260 off.
        JsonNode order = placePromoOrder(token, 2, 2, "DELIVERY", "TREAT15");

        assertThat(order.get("discount").asDouble()).isEqualTo(1260.0);
        assertThat(order.get("deliveryPrice").asDouble()).isEqualTo(0.0);
        assertThat(order.get("totalPrice").asDouble()).isEqualTo(7140.0);
    }

    @Test
    void createOrder_save10BelowMinimum_isRefusedAndNotCounted() throws Exception {
        String token = registerCustomer();
        double placedBefore = placedCount();
        double promoBefore = promoCount("SAVE10");

        Map<String, Object> body = orderBody(1, "TAKEAWAY", null);
        body.put("promoCode", "SAVE10"); // 1 x Lavash Wrap = 1,800 < 3,000
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Add 1,200 AMD more to use this code"));

        assertThat(placedCount()).isEqualTo(placedBefore);
        assertThat(promoCount("SAVE10")).isEqualTo(promoBefore);
    }

    @Test
    void createOrder_unknownChef_isNotFound() throws Exception {
        String token = registerCustomer();
        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(orderBody(999999, "TAKEAWAY", null))))
                .andExpect(status().isNotFound());
    }

    @Test
    void createOrder_deliveryWithAddress_keepsAddress() throws Exception {
        String token = registerCustomer();
        String number = placeOrder(token, "DELIVERY",
                Map.of("city", "Yerevan", "street", "Abovyan", "building", "12", "apartment", "5"));

        JsonNode address = orderByNumber(number).get("addressDto");
        assertThat(address.get("city").asText()).isEqualTo("Yerevan");
        assertThat(address.get("street").asText()).isEqualTo("Abovyan");
        assertThat(address.get("building").asText()).isEqualTo("12");
        assertThat(address.get("apartment").asText()).isEqualTo("5");
    }

    @Test
    void createOrder_takeawayWithAddress_ignoresAddress() throws Exception {
        String token = registerCustomer();
        String number = placeOrder(token, "TAKEAWAY", Map.of("city", "Yerevan", "street", "Abovyan"));

        // The order DTO serialises every field, so a takeaway order carries "addressDto": null.
        JsonNode order = orderByNumber(number);
        assertThat(order.has("addressDto")).isTrue();
        assertThat(order.get("addressDto").isNull()).isTrue();
    }

    @Test
    void createOrder_countsPlacedOrder() throws Exception {
        String token = registerCustomer();
        double before = placedCount();

        placeOrder(token, "TAKEAWAY", null);

        assertThat(placedCount()).isEqualTo(before + 1);
    }

    @Test
    void getOrderByNumber_unknown_isNotFound() throws Exception {
        mockMvc.perform(get("/api/order/number/FM-999999999"))
                .andExpect(status().isNotFound());
    }
}

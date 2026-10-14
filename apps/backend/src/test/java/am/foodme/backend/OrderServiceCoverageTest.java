package am.foodme.backend;

import am.foodme.backend.repository.OrderRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Covers OrderService / AdminOrderService paths the feature tests don't reach:
 * delivery-price rules, not-found lookups, the delivery address on an order, and
 * cancelling an order the kitchen already finished (DELIVERED) or declined (REJECTED).
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
class OrderServiceCoverageTest {

    private static final String ONLY_NEW = "Only new orders can be cancelled.";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

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

    private String adminToken() throws Exception {
        String response = mockMvc.perform(post("/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("username", "admin", "password", "admin123"))))
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

    private void adminSetStatus(String admin, long id, String newStatus) throws Exception {
        mockMvc.perform(patch("/admin/order/" + id + "/status")
                        .header("Authorization", "Bearer " + admin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"" + newStatus + "\",\"rejectReason\":null}"))
                .andExpect(status().isOk());
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

        JsonNode address = orderByNumber(number).get("addressDto");
        assertThat(address == null || address.isNull()).isTrue();
    }

    @Test
    void getOrderByNumber_unknown_isNotFound() throws Exception {
        mockMvc.perform(get("/api/order/number/FM-999999999"))
                .andExpect(status().isNotFound());
    }

    @Test
    void adminGetOrder_unknownId_isNotFound() throws Exception {
        mockMvc.perform(get("/admin/order/999999").header("Authorization", "Bearer " + adminToken()))
                .andExpect(status().isNotFound());
    }

    @Test
    void cancelOrder_delivered_isRefused() throws Exception {
        String token = registerCustomer();
        String admin = adminToken();
        String number = placeOrder(token, "TAKEAWAY", null);
        long id = orderByNumber(number).get("id").asLong();
        adminSetStatus(admin, id, "ACCEPTED");
        adminSetStatus(admin, id, "DELIVERED");

        mockMvc.perform(post("/api/customer/orders/" + number + "/cancel").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(ONLY_NEW));
        assertThat(orderByNumber(number).get("status").asText()).isEqualTo("DELIVERED");
    }

    @Test
    void cancelOrder_rejected_isRefused() throws Exception {
        String token = registerCustomer();
        String admin = adminToken();
        String number = placeOrder(token, "TAKEAWAY", null);
        long id = orderByNumber(number).get("id").asLong();
        adminSetStatus(admin, id, "REJECTED");

        mockMvc.perform(post("/api/customer/orders/" + number + "/cancel").header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(ONLY_NEW));
        assertThat(orderByNumber(number).get("status").asText()).isEqualTo("REJECTED");
    }
}

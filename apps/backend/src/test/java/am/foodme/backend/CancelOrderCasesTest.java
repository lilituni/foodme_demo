package am.foodme.backend;

import am.foodme.backend.repository.OrderRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * KAN-9 Cancel order: one test per approved API test case (functional-testing
 * workflow, step 06). The cases in runs/KAN-9/spec.yaml are the spec; every
 * assertion checks the case's expected value (`// expected[n]`). Lines marked
 * `// sync:` only set up or read state and check no case fact.
 *
 * Orders are placed for real (O-std: 1 x Mushroom soup, Chef Verona, Takeaway,
 * cash), which consumes foodme.order_number_seq. OrderControllerTest assumes the
 * first API order is FM-100001, so each test deletes its orders and restarts the
 * sequence where it found it. @AutoConfigureObservability exposes
 * /actuator/prometheus for KAN-9-TC-13.
 */
@SpringBootTest
@AutoConfigureMockMvc
@AutoConfigureObservability
@ActiveProfiles("test")
class CancelOrderCasesTest {

    private static final long MUSHROOM_SOUP = 132L;
    private static final String ONLY_NEW = "Only new orders can be cancelled.";
    private static final String CANCELLED_FINAL = "Order was cancelled by the customer; cancelled orders are final";

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
    void seedChefVerona() {
        // Chef Verona (17) and Mushroom soup (132) as on the SUT; data.sql seeds only chefs 1-3.
        jdbc.execute("""
                MERGE INTO foodme.chef (id, username, phone_number, email, avatar_url, banner_url, status,
                    full_name_en, full_name_am, full_name_ru, description_en, description_am, description_ru,
                    kitchen_en, kitchen_am, kitchen_ru, rating, platform_fee, delivery_price, free_delivery_from, priority_index)
                KEY (id) VALUES
                (17, 'verona', '+37493000017', 'verona@foodme.am', '/img/chef/17-avatar.jpg', '/img/chef/17-banner.jpg', 'ACTIVE',
                 'Verona', 'Verona', 'Verona', 'Bakery.', 'Bakery.', 'Bakery.',
                 'Bakery', 'Bakery', 'Bakery', 4.5, 0.12, 500.0, 5000.0, 3)
                """);
        jdbc.execute("""
                MERGE INTO foodme.dish (id, name_en, name_am, name_ru, description_en, price, url, portion_en, portion_am, portion_ru,
                    status, minimum_order_count, priority_index, chef_id, dish_tag_id)
                KEY (id) VALUES
                (132, 'Mushroom soup', 'Mushroom soup', 'Mushroom soup', 'Soup.', 1950.0, '/img/dish/132.jpg', '1', '1', '1', 'ACTIVE', 1, 0, 17, 1)
                """);
        sequenceBefore = jdbc.queryForObject(
                "SELECT BASE_VALUE FROM INFORMATION_SCHEMA.SEQUENCES "
                        + "WHERE SEQUENCE_SCHEMA = 'FOODME' AND SEQUENCE_NAME = 'ORDER_NUMBER_SEQ'",
                Long.class);
    }

    @AfterEach
    void removePlacedOrders() {
        placedNumbers.forEach(number -> orderRepository.findByNumber(number).ifPresent(orderRepository::delete));
        jdbc.execute("ALTER SEQUENCE foodme.order_number_seq RESTART WITH " + sequenceBefore);
        // Chef 17 is not in data.sql; left ACTIVE it adds to other classes' chef counts.
        jdbc.update("UPDATE foodme.chef SET status = 'INACTIVE' WHERE id = 17");
    }

    private String registerCustomer(String who) throws Exception {
        String email = "stlc-kan9-" + who + "-" + UUID.randomUUID() + "@example.com";
        String response = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "fullName", "STLC Tester",
                                "email", email,
                                "phoneNumber", "+37491000000",
                                "password", "secret123"
                        ))))
                .andExpect(status().isOk()) // sync: account created
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    private String adminToken() throws Exception {
        String response = mockMvc.perform(post("/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("username", "admin", "password", "admin123"))))
                .andExpect(status().isOk()) // sync: admin signed in
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    /** Places O-std as the customer and returns its number FM-xxxxxx. */
    private String placeOStd(String token, String caseId) throws Exception {
        String response = mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "chefId", 17,
                                "receiverName", "STLC Tester",
                                "receiverPhoneNumber", "+37491000000",
                                "paymentType", "CASH",
                                "deliveryMethod", "TAKEAWAY",
                                "note", "STLC KAN-9 " + caseId + " auto",
                                "createOrderDishes", List.of(Map.of("dishId", MUSHROOM_SOUP, "quantity", 1))
                        ))))
                .andExpect(status().isOk()) // sync: order placed
                .andReturn().getResponse().getContentAsString();
        String number = objectMapper.readTree(response).get("number").asText();
        placedNumbers.add(number);
        return number;
    }

    private ResultActions cancel(String token, String number) throws Exception {
        var request = post("/api/customer/orders/" + number + "/cancel");
        if (token != null) {
            request.header("Authorization", "Bearer " + token);
        }
        return mockMvc.perform(request);
    }

    /** "Reload My Orders as the customer and read the order's status": GET /api/customer/orders. */
    private String statusOnMyOrders(String token, String number) throws Exception {
        String response = mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk()) // sync: My Orders readable
                .andReturn().getResponse().getContentAsString();
        for (JsonNode order : objectMapper.readTree(response).get("list")) {
            if (number.equals(order.get("number").asText())) {
                return order.get("status").asText();
            }
        }
        return null;
    }

    private long orderId(String number) throws Exception {
        String response = mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(status().isOk()) // sync: order found
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("id").asLong();
    }

    private String prometheus() throws Exception {
        return mockMvc.perform(get("/actuator/prometheus"))
                .andExpect(status().isOk()) // sync: scrape endpoint readable
                .andReturn().getResponse().getContentAsString();
    }

    /** Value of a counter in the scrape text, or null when the metric isn't there. */
    private static Double counter(String scrape, String metric) {
        Matcher m = Pattern.compile("(?m)^" + metric + "(\\{[^}]*})?\\s+(\\S+)$").matcher(scrape);
        return m.find() ? Double.valueOf(m.group(2)) : null;
    }

    @Test
    @DisplayName("KAN-9-TC-07 API: cancelling someone else's order returns 404, like an unknown order")
    void tc07_otherCustomersOrderOrUnknown_404() throws Exception {
        String customerA = registerCustomer("a");
        String customerB = registerCustomer("b");
        String number = placeOStd(customerA, "TC-07");
        String unknown = "FM-" + (Long.parseLong(number.substring(3)) + 1_000_000);

        cancel(customerB, number).andExpect(status().isNotFound()); // expected[1]
        cancel(customerB, unknown).andExpect(status().isNotFound()); // expected[2]
        assertThat(statusOnMyOrders(customerA, number)).isEqualTo("NEW"); // expected[3] still Received
    }

    @Test
    @DisplayName("KAN-9-TC-08 API: cancelling while not signed in returns 401")
    void tc08_notSignedIn_401() throws Exception {
        String customerA = registerCustomer("a");
        String number = placeOStd(customerA, "TC-08");

        cancel(null, number).andExpect(status().isUnauthorized()); // expected[1]
        assertThat(statusOnMyOrders(customerA, number)).isEqualTo("NEW"); // expected[2] still Received
    }

    @Test
    @DisplayName("KAN-9-TC-09 API: cancelling an already cancelled order is refused")
    void tc09_alreadyCancelled_refused() throws Exception {
        String customerA = registerCustomer("a");
        String number = placeOStd(customerA, "TC-09");

        cancel(customerA, number).andExpect(status().isOk()); // expected[1] first cancel succeeds
        assertThat(statusOnMyOrders(customerA, number)).isEqualTo("CANCELLED"); // expected[1] ... and the order is Cancelled

        cancel(customerA, number)
                .andExpect(status().isBadRequest()) // expected[2] refused
                .andExpect(jsonPath("$.message").value(ONLY_NEW)); // expected[2] its response says the reason
        assertThat(statusOnMyOrders(customerA, number)).isEqualTo("CANCELLED"); // expected[3]
    }

    @Test
    @DisplayName("KAN-9-TC-11 API: admin can't move a cancelled order to any other status")
    void tc11_adminOnCancelledOrder_refused() throws Exception {
        String customerA = registerCustomer("a");
        String admin = adminToken();
        String fmC = placeOStd(customerA, "TC-11");
        cancel(customerA, fmC).andExpect(status().isOk()); // sync: FM-c cancelled for this case
        long idC = orderId(fmC);

        // Bodies as the admin panel sends them (captured in step 05): Accept, Deliver, Reject (with a reason).
        List<String> bodies = List.of(
                "{\"status\":\"ACCEPTED\",\"rejectReason\":null}",
                "{\"status\":\"DELIVERED\",\"rejectReason\":null}",
                "{\"status\":\"REJECTED\",\"rejectReason\":\"STLC KAN-9 TC-11 auto\"}");
        for (String body : bodies) {
            mockMvc.perform(patch("/admin/order/" + idC + "/status")
                            .header("Authorization", "Bearer " + admin)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isBadRequest()) // expected[1] refused
                    .andExpect(jsonPath("$.message").value(CANCELLED_FINAL)); // expected[1] ... with the reason
        }

        // expected[2]: FM-c is still Cancelled, in the admin panel and on customer A's My Orders
        mockMvc.perform(get("/admin/order/" + idC).header("Authorization", "Bearer " + admin))
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        assertThat(statusOnMyOrders(customerA, fmC)).isEqualTo("CANCELLED");
    }

    @Test
    @DisplayName("KAN-9-TC-13 Prometheus counts a cancelled order next to placed orders")
    void tc13_prometheus_cancelledCounterNextToPlaced() throws Exception {
        String customerA = registerCustomer("a");
        String before = prometheus();
        Double c0 = counter(before, "foodme_orders_cancelled_total");
        Double p0 = counter(before, "foodme_orders_total");

        String number = placeOStd(customerA, "TC-13");
        cancel(customerA, number).andExpect(status().isOk()); // sync: cancelled

        String after = prometheus();
        Double c1 = counter(after, "foodme_orders_cancelled_total");
        Double p1 = counter(after, "foodme_orders_total");

        // expected[1]: a cancelled-orders counter exists next to the placed-orders counter
        assertThat(c1).as("foodme_orders_cancelled_total").isNotNull();
        assertThat(p1).as("foodme_orders_total").isNotNull();
        // A counter not yet registered before its first increment counts as 0.
        assertThat(c1).isEqualTo((c0 == null ? 0.0 : c0) + 1); // expected[2] C0 + 1
        assertThat(p1).isEqualTo((p0 == null ? 0.0 : p0) + 1); // expected[3] P0 + 1
    }
}

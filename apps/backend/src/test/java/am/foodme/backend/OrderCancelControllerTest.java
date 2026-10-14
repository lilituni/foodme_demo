package am.foodme.backend;

import am.foodme.backend.model.Chef;
import am.foodme.backend.model.Customer;
import am.foodme.backend.model.Order;
import am.foodme.backend.repository.ChefRepository;
import am.foodme.backend.repository.CustomerRepository;
import am.foodme.backend.repository.OrderRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * KAN-9 Cancel order. Like OrderReviewControllerTest, orders are inserted through
 * the repository with their own "CX-" numbers so this class never consumes
 * foodme.order_number_seq (OrderControllerTest assumes the first API order is FM-100001).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderCancelControllerTest {

    private static final long CHEF_ID = 2L;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private CustomerRepository customerRepository;

    @Autowired
    private ChefRepository chefRepository;

    @Autowired
    private MeterRegistry meterRegistry;

    private record TestCustomer(String token, String email) {
    }

    private TestCustomer registerCustomer() throws Exception {
        String email = "cancel-test-" + UUID.randomUUID() + "@example.com";
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
        return new TestCustomer(objectMapper.readTree(response).get("token").asText(), email);
    }

    private String adminToken() throws Exception {
        String response = mockMvc.perform(post("/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", "admin",
                                "password", "admin123"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(response).get("token").asText();
    }

    private Order insertOrder(TestCustomer owner, String status) {
        Customer customer = customerRepository.findByEmail(owner.email()).orElseThrow();
        Chef chef = chefRepository.findById(CHEF_ID).orElseThrow();
        Order order = new Order();
        order.setNumber("CX-" + UUID.randomUUID().toString().substring(0, 8));
        order.setStatus(status);
        order.setChef(chef);
        order.setCustomer(customer);
        order.setReceiverName("Ann");
        order.setPaymentType("CASH");
        order.setDeliveryMethod("TAKEAWAY");
        order.setTotalPrice(4800.0);
        order.setDeliveryPrice(0.0);
        order.setCreatedAt(LocalDateTime.now());
        return orderRepository.save(order);
    }

    private ResultActions cancel(TestCustomer customer, String number) throws Exception {
        var request = post("/api/customer/orders/" + number + "/cancel");
        if (customer != null) {
            request.header("Authorization", "Bearer " + customer.token());
        }
        return mockMvc.perform(request);
    }

    private double cancelledCount() {
        var counter = meterRegistry.find("foodme.orders.cancelled").counter();
        return counter == null ? 0.0 : counter.count();
    }

    private String statusOf(String number) {
        return orderRepository.findByNumber(number).orElseThrow().getStatus();
    }

    @Test
    void cancel_ownNewOrder_isCancelledAndCounted() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, "NEW").getNumber();
        double before = cancelledCount();

        cancel(customer, number)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value(number))
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        assertThat(statusOf(number)).isEqualTo("CANCELLED");
        assertThat(cancelledCount()).isEqualTo(before + 1);

        // Visible as Cancelled in the customer's history and on the public tracking endpoint.
        mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + customer.token()))
                .andExpect(jsonPath("$.list[0].number").value(number))
                .andExpect(jsonPath("$.list[0].status").value("CANCELLED"));
        mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    @Test
    void cancel_acceptedOrder_isRefusedAndUnchanged() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, "ACCEPTED").getNumber();
        double before = cancelledCount();

        cancel(customer, number)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Only new orders can be cancelled."));

        assertThat(statusOf(number)).isEqualTo("ACCEPTED");
        assertThat(cancelledCount()).isEqualTo(before);
    }

    @Test
    void cancel_alreadyCancelledOrder_isRefused() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, "NEW").getNumber();
        cancel(customer, number).andExpect(status().isOk());

        cancel(customer, number)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Only new orders can be cancelled."));
    }

    @Test
    void cancel_someoneElsesOrder_looksLikeItDoesNotExist() throws Exception {
        TestCustomer owner = registerCustomer();
        TestCustomer stranger = registerCustomer();
        String number = insertOrder(owner, "NEW").getNumber();

        String strangerBody = cancel(stranger, number)
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();
        String missingBody = cancel(stranger, "CX-doesnotexist")
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();

        // Same message shape as a truly missing order - nothing reveals that it exists.
        assertThat(objectMapper.readTree(strangerBody).get("message").asText())
                .isEqualTo("Order " + number + " not found");
        assertThat(objectMapper.readTree(missingBody).get("message").asText())
                .isEqualTo("Order CX-doesnotexist not found");
        assertThat(statusOf(number)).isEqualTo("NEW");
    }

    @Test
    void cancel_notSignedIn_isUnauthorized() throws Exception {
        TestCustomer owner = registerCustomer();
        String number = insertOrder(owner, "NEW").getNumber();

        cancel(null, number).andExpect(status().isUnauthorized());

        assertThat(statusOf(number)).isEqualTo("NEW");
    }

    @Test
    void cancel_withAdminToken_isForbidden() throws Exception {
        TestCustomer owner = registerCustomer();
        String number = insertOrder(owner, "NEW").getNumber();

        mockMvc.perform(post("/api/customer/orders/" + number + "/cancel")
                        .header("Authorization", "Bearer " + adminToken()))
                .andExpect(status().isForbidden());

        assertThat(statusOf(number)).isEqualTo("NEW");
    }

    @Test
    void admin_cannotMoveCancelledOrderToAnyStatus() throws Exception {
        TestCustomer owner = registerCustomer();
        Order order = insertOrder(owner, "NEW");
        cancel(owner, order.getNumber()).andExpect(status().isOk());
        String token = adminToken();

        for (String target : new String[]{"NEW", "ACCEPTED", "DELIVERED", "REJECTED"}) {
            mockMvc.perform(patch("/admin/order/" + order.getId() + "/status")
                            .header("Authorization", "Bearer " + token)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(Map.of(
                                    "status", target,
                                    "rejectReason", "too late"))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message")
                            .value("Order was cancelled by the customer; cancelled orders are final"));
        }

        assertThat(statusOf(order.getNumber())).isEqualTo("CANCELLED");
    }

    @Test
    void admin_canFilterOrdersByCancelledStatus() throws Exception {
        TestCustomer owner = registerCustomer();
        String cancelled = insertOrder(owner, "NEW").getNumber();
        cancel(owner, cancelled).andExpect(status().isOk());
        insertOrder(owner, "NEW");

        String body = mockMvc.perform(get("/admin/order")
                        .param("status", "CANCELLED")
                        .param("size", "100")
                        .header("Authorization", "Bearer " + adminToken()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        var list = objectMapper.readTree(body).get("list");
        assertThat(list).isNotEmpty();
        list.forEach(o -> assertThat(o.get("status").asText()).isEqualTo("CANCELLED"));
        assertThat(list.findValuesAsText("number")).contains(cancelled);
    }

    @Test
    void admin_regularTransitionsStillWork() throws Exception {
        TestCustomer owner = registerCustomer();
        Order order = insertOrder(owner, "NEW");
        String token = adminToken();

        mockMvc.perform(patch("/admin/order/" + order.getId() + "/status")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("status", "REJECTED", "rejectReason", "Out of lamb"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.rejectReason").value("Out of lamb"));
    }
}

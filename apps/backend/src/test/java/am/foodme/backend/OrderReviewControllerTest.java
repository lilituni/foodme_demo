package am.foodme.backend;

import am.foodme.backend.model.Chef;
import am.foodme.backend.model.Customer;
import am.foodme.backend.model.Order;
import am.foodme.backend.repository.ChefRepository;
import am.foodme.backend.repository.CustomerRepository;
import am.foodme.backend.repository.OrderRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * KAN-8 Order Ratings. Orders are inserted straight through the repository with
 * their own "RV-" numbers rather than via POST /api/order, so this class never
 * consumes foodme.order_number_seq (OrderControllerTest's FM-FLAKE-02 cases
 * assume the first API-created order is FM-100001).
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class OrderReviewControllerTest {

    // Chef 2 for general cases; chef 3 is reserved for the averaging test so
    // its rating is only ever touched there.
    private static final long CHEF_ID = 2L;
    private static final long AVERAGE_CHEF_ID = 3L;

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

    private record TestCustomer(String token, String email) {
    }

    private TestCustomer registerCustomer() throws Exception {
        String email = "review-test-" + UUID.randomUUID() + "@example.com";
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

    private String insertOrder(TestCustomer owner, long chefId, String status) {
        Customer customer = customerRepository.findByEmail(owner.email()).orElseThrow();
        Chef chef = chefRepository.findById(chefId).orElseThrow();
        Order order = new Order();
        order.setNumber("RV-" + UUID.randomUUID().toString().substring(0, 8));
        order.setStatus(status);
        order.setChef(chef);
        order.setCustomer(customer);
        order.setReceiverName("Ann");
        order.setPaymentType("CASH");
        order.setDeliveryMethod("TAKEAWAY");
        order.setTotalPrice(1800.0);
        order.setDeliveryPrice(0.0);
        order.setCreatedAt(LocalDateTime.now());
        return orderRepository.save(order).getNumber();
    }

    private ResultActions review(TestCustomer customer, String number, Object rating, String comment) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("rating", rating);
        body.put("comment", comment);
        var request = post("/api/customer/orders/" + number + "/review")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(body));
        if (customer != null) {
            request.header("Authorization", "Bearer " + customer.token());
        }
        return mockMvc.perform(request);
    }

    @Test
    void review_deliveredOwnOrder_isSavedAndShownOnOrder() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        review(customer, number, 4, "  Tasty and warm  ")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rating").value(4))
                .andExpect(jsonPath("$.comment").value("Tasty and warm"))
                .andExpect(jsonPath("$.createdAt").exists());

        mockMvc.perform(get("/api/customer/orders").header("Authorization", "Bearer " + customer.token()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.list[0].number").value(number))
                .andExpect(jsonPath("$.list[0].review.rating").value(4))
                .andExpect(jsonPath("$.list[0].review.comment").value("Tasty and warm"));

        mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.review.rating").value(4));
    }

    @Test
    void review_withoutComment_isAccepted() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        review(customer, number, 5, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rating").value(5))
                .andExpect(jsonPath("$.comment").doesNotExist());
    }

    @Test
    void unreviewedOrder_hasNoReview() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.review").doesNotExist());
    }

    @Test
    void review_withoutToken_unauthorized() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        review(null, number, 5, null).andExpect(status().isUnauthorized());
    }

    @Test
    void review_someoneElsesOrder_looksLikeMissingOrder() throws Exception {
        TestCustomer owner = registerCustomer();
        TestCustomer stranger = registerCustomer();
        String number = insertOrder(owner, CHEF_ID, "DELIVERED");

        review(stranger, number, 1, "not mine")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Order " + number + " not found"));
        review(stranger, "RV-missing", 1, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Order RV-missing not found"));

        // The owner can still review it afterwards.
        review(owner, number, 3, null).andExpect(status().isOk());
    }

    @Test
    void review_notDeliveredOrder_isRejected() throws Exception {
        TestCustomer customer = registerCustomer();
        for (String status : new String[]{"NEW", "ACCEPTED", "REJECTED"}) {
            String number = insertOrder(customer, CHEF_ID, status);
            review(customer, number, 5, null)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Only delivered orders can be reviewed."));
        }
    }

    @Test
    void review_sameOrderTwice_isRejected() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        review(customer, number, 5, null).andExpect(status().isOk());
        review(customer, number, 1, "changed my mind")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Order already reviewed."));

        mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(jsonPath("$.review.rating").value(5));
    }

    @Test
    void review_invalidRatings_areRejected() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        for (Object rating : new Object[]{0, 6, -1, 4.5, null}) {
            review(customer, number, rating, null)
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message").value("Rating must be a whole number from 1 to 5"));
        }
        review(customer, number, "five", null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Malformed request body"));

        // None of the refused attempts consumed the order's single review.
        review(customer, number, 2, null).andExpect(status().isOk());
    }

    @Test
    void review_commentLength_limitIs1000() throws Exception {
        TestCustomer customer = registerCustomer();
        String tooLong = insertOrder(customer, CHEF_ID, "DELIVERED");
        String atLimit = insertOrder(customer, CHEF_ID, "DELIVERED");

        review(customer, tooLong, 4, "a".repeat(1001))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Comment must be at most 1000 characters"));
        review(customer, atLimit, 4, "a".repeat(1000))
                .andExpect(status().isOk());
    }

    @Test
    void review_updatesChefRatingToRoundedAverage() throws Exception {
        TestCustomer customer = registerCustomer();

        review(customer, insertOrder(customer, AVERAGE_CHEF_ID, "DELIVERED"), 5, null).andExpect(status().isOk());
        mockMvc.perform(get("/api/chef/" + AVERAGE_CHEF_ID)).andExpect(jsonPath("$.rating").value(5.0));

        review(customer, insertOrder(customer, AVERAGE_CHEF_ID, "DELIVERED"), 4, null).andExpect(status().isOk());
        mockMvc.perform(get("/api/chef/" + AVERAGE_CHEF_ID)).andExpect(jsonPath("$.rating").value(4.5));

        // (5 + 4 + 4) / 3 = 4.333... -> 4.3
        review(customer, insertOrder(customer, AVERAGE_CHEF_ID, "DELIVERED"), 4, null).andExpect(status().isOk());
        mockMvc.perform(get("/api/chef/" + AVERAGE_CHEF_ID)).andExpect(jsonPath("$.rating").value(4.3));
    }

    @Test
    void review_ratingOne_isAccepted() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        // Lower valid boundary (0 is refused in review_invalidRatings_areRejected).
        review(customer, number, 1, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rating").value(1));
    }

    @Test
    void review_blankComment_isStoredAsNull() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");

        review(customer, number, 4, "   ")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.comment").doesNotExist());
    }

    @Test
    void review_withAdminToken_isForbidden() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "DELIVERED");
        String adminResponse = mockMvc.perform(post("/admin/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", "admin",
                                "password", "admin123"
                        ))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String adminToken = objectMapper.readTree(adminResponse).get("token").asText();

        mockMvc.perform(post("/api/customer/orders/" + number + "/review")
                        .header("Authorization", "Bearer " + adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of("rating", 5))))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/order/number/" + number))
                .andExpect(jsonPath("$.review").doesNotExist());
    }

    @Test
    void refusedReview_leavesChefRatingUnchanged() throws Exception {
        TestCustomer customer = registerCustomer();
        String number = insertOrder(customer, CHEF_ID, "NEW");
        Double before = chefRepository.findById(CHEF_ID).orElseThrow().getRating();

        review(customer, number, 1, null).andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/chef/" + CHEF_ID))
                .andExpect(jsonPath("$.rating").value(before));
    }

    // Regression for the global HttpMessageNotReadableException handler added
    // with this feature: other endpoints now answer malformed JSON with 400.
    @Test
    void malformedJson_onExistingEndpoint_returns400() throws Exception {
        TestCustomer customer = registerCustomer();

        mockMvc.perform(post("/api/order")
                        .header("Authorization", "Bearer " + customer.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{not json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Malformed request body"));
    }
}

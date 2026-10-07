package am.foodme.backend.service;

import am.foodme.backend.dto.CreateOrderReviewDto;
import am.foodme.backend.dto.OrderReviewDto;
import am.foodme.backend.exceptionHandler.BadRequestException;
import am.foodme.backend.exceptionHandler.NotFoundException;
import am.foodme.backend.model.Chef;
import am.foodme.backend.model.Customer;
import am.foodme.backend.model.Order;
import am.foodme.backend.model.OrderReview;
import am.foodme.backend.repository.ChefRepository;
import am.foodme.backend.repository.CustomerRepository;
import am.foodme.backend.repository.OrderRepository;
import am.foodme.backend.repository.OrderReviewRepository;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;

@Service
public class OrderReviewService {

    static final String NOT_DELIVERED_MESSAGE = "Only delivered orders can be reviewed.";
    static final String ALREADY_REVIEWED_MESSAGE = "Order already reviewed.";

    private final OrderReviewRepository orderReviewRepository;
    private final OrderRepository orderRepository;
    private final CustomerRepository customerRepository;
    private final ChefRepository chefRepository;
    private final MeterRegistry meterRegistry;

    public OrderReviewService(OrderReviewRepository orderReviewRepository, OrderRepository orderRepository,
                              CustomerRepository customerRepository, ChefRepository chefRepository,
                              MeterRegistry meterRegistry) {
        this.orderReviewRepository = orderReviewRepository;
        this.orderRepository = orderRepository;
        this.customerRepository = customerRepository;
        this.chefRepository = chefRepository;
        this.meterRegistry = meterRegistry;
    }

    @Transactional
    public OrderReviewDto createReview(String customerEmail, String orderNumber, CreateOrderReviewDto request) {
        Customer customer = customerRepository.findByEmail(customerEmail == null ? "" : customerEmail.trim().toLowerCase())
                .orElseThrow(() -> new NotFoundException("Customer not found"));

        // Someone else's order is reported exactly like a missing one, so order
        // numbers can't be probed for existence.
        Order order = orderRepository.findByNumber(orderNumber)
                .filter(o -> o.getCustomer() != null && customer.getId().equals(o.getCustomer().getId()))
                .orElseThrow(() -> new NotFoundException("Order " + orderNumber + " not found"));

        if (!"DELIVERED".equals(order.getStatus())) {
            throw new BadRequestException(NOT_DELIVERED_MESSAGE);
        }
        if (orderReviewRepository.existsByOrderId(order.getId())) {
            throw new BadRequestException(ALREADY_REVIEWED_MESSAGE);
        }

        Chef chef = chefRepository.findByIdForUpdate(order.getChef().getId())
                .orElseThrow(() -> new NotFoundException("Chef " + order.getChef().getId() + " not found"));

        OrderReview review = new OrderReview();
        review.setOrder(order);
        review.setCustomer(customer);
        review.setChef(chef);
        review.setRating(request.getRating().intValueExact());
        review.setComment(normalizeComment(request.getComment()));
        review.setCreatedAt(LocalDateTime.now());

        OrderReview saved;
        try {
            saved = orderReviewRepository.saveAndFlush(review);
        } catch (DataIntegrityViolationException e) {
            // Lost a race with a concurrent review of the same order (unique order_id).
            throw new BadRequestException(ALREADY_REVIEWED_MESSAGE);
        }

        chef.setRating(roundToOneDecimal(orderReviewRepository.averageRatingForChef(chef.getId())));
        chefRepository.save(chef);

        meterRegistry.counter("foodme.order_reviews", "rating", String.valueOf(saved.getRating())).increment();

        return OrderReviewDto.mapEntityToDto(saved);
    }

    static Double roundToOneDecimal(Double value) {
        if (value == null) {
            return null;
        }
        return Math.round(value * 10) / 10.0;
    }

    private static String normalizeComment(String comment) {
        if (comment == null) {
            return null;
        }
        String trimmed = comment.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}

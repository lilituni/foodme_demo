package am.foodme.backend.service;

import am.foodme.backend.dto.AdminListResponseDto;
import am.foodme.backend.dto.OrderDto;
import am.foodme.backend.exceptionHandler.BadRequestException;
import am.foodme.backend.exceptionHandler.NotFoundException;
import am.foodme.backend.model.Order;
import am.foodme.backend.repository.OrderRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class AdminOrderService {

    private static final Map<String, Set<String>> ALLOWED_TRANSITIONS = Map.of(
            "NEW", Set.of("ACCEPTED", "REJECTED"),
            "ACCEPTED", Set.of("DELIVERED", "REJECTED")
    );

    private final OrderRepository orderRepository;

    public AdminOrderService(OrderRepository orderRepository) {
        this.orderRepository = orderRepository;
    }

    @Transactional(readOnly = true)
    public AdminListResponseDto<OrderDto> list(int page, int size, String status) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt"));
        Page<Order> orderPage = (status == null || status.isBlank())
                ? orderRepository.findAll(pageable)
                : orderRepository.findByStatus(status, pageable);
        List<OrderDto> list = orderPage.getContent().stream()
                .map(OrderDto::mapEntityToDto)
                .collect(Collectors.toList());
        return new AdminListResponseDto<>(list, orderPage.getTotalElements());
    }

    @Transactional(readOnly = true)
    public OrderDto getById(Long id) {
        return OrderDto.mapEntityToDto(findEntity(id));
    }

    @Transactional
    public OrderDto updateStatus(Long id, String newStatus, String rejectReason) {
        Order order = findEntity(id);
        String currentStatus = order.getStatus();
        // KAN-9: CANCELLED has no outgoing transitions; say so explicitly.
        if ("CANCELLED".equals(currentStatus)) {
            throw new BadRequestException("Order was cancelled by the customer; cancelled orders are final");
        }
        Set<String> allowed = ALLOWED_TRANSITIONS.get(currentStatus);
        if (allowed == null || !allowed.contains(newStatus)) {
            throw new BadRequestException("Cannot transition order from " + currentStatus + " to " + newStatus);
        }
        // Compare-and-set so a customer cancel that lands between the read above and
        // this write isn't overwritten (the cancel path uses the same guard).
        if (orderRepository.transitionStatus(id, currentStatus, newStatus) == 0) {
            throw new BadRequestException("Order status changed in the meantime; reload and try again");
        }
        order = findEntity(id);
        if ("REJECTED".equals(newStatus)) {
            order.setRejectReason(rejectReason);
        }
        return OrderDto.mapEntityToDto(orderRepository.save(order));
    }

    private Order findEntity(Long id) {
        return orderRepository.findById(id)
                .orElseThrow(() -> new NotFoundException("Order " + id + " not found"));
    }
}

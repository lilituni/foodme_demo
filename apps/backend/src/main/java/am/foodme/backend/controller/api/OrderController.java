package am.foodme.backend.controller.api;

import am.foodme.backend.dto.DeliveryPriceRequestDto;
import am.foodme.backend.dto.DeliveryPriceResponseDto;
import am.foodme.backend.dto.OrderCreateResponseDto;
import am.foodme.backend.dto.OrderDto;
import am.foodme.backend.dto.PromoQuoteRequestDto;
import am.foodme.backend.dto.PromoQuoteResponseDto;
import am.foodme.backend.service.OrderService;
import am.foodme.backend.utils.ControllerUtil;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(ControllerUtil.API_ORDER_CONTROLLER)
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping("/delivery-price")
    public DeliveryPriceResponseDto deliveryPrice(@RequestBody DeliveryPriceRequestDto request) {
        return orderService.calculateDeliveryPrice(request);
    }

    @PostMapping("/promo-code")
    public PromoQuoteResponseDto promoCode(@RequestBody PromoQuoteRequestDto request) {
        return orderService.quotePromoCode(request);
    }

    @PostMapping
    public OrderCreateResponseDto createOrder(@Valid @RequestBody OrderDto orderDto,
                                              Authentication authentication) {
        return orderService.createOrder(orderDto, authentication.getName());
    }

    @GetMapping("/number/{number}")
    public OrderDto getOrderByNumber(@PathVariable String number) {
        return orderService.getOrderByNumber(number);
    }
}

package am.foodme.backend.service;

import am.foodme.backend.dto.PromoQuoteResponseDto;
import am.foodme.backend.dto.PromoQuoteResponseDto.Reason;
import am.foodme.backend.model.PromoCode;
import am.foodme.backend.repository.PromoCodeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Optional;

/** KAN-11: validates and prices a percentage promo code. Pure pricing - no side effects. */
@Service
public class PromoCodeService {

    private final PromoCodeRepository promoCodeRepository;

    public PromoCodeService(PromoCodeRepository promoCodeRepository) {
        this.promoCodeRepository = promoCodeRepository;
    }

    public static String normalise(String code) {
        return code == null ? "" : code.trim().toUpperCase(Locale.ROOT);
    }

    @Transactional(readOnly = true)
    public PromoQuoteResponseDto evaluate(String rawCode, double subtotal, double deliveryPrice) {
        String code = normalise(rawCode);
        PromoQuoteResponseDto quote = new PromoQuoteResponseDto();
        quote.setCode(code);
        quote.setSubtotal(subtotal);
        quote.setDeliveryPrice(deliveryPrice);
        quote.setDiscount(0.0);
        quote.setTotal(subtotal + deliveryPrice);

        Optional<PromoCode> found = code.isEmpty() ? Optional.empty() : promoCodeRepository.findByCode(code);
        if (found.isEmpty()) {
            return reject(quote, Reason.NOT_FOUND, "Code not found");
        }
        PromoCode promo = found.get();
        quote.setPercentOff(promo.getPercentOff());

        if (promo.getExpiresAt() != null && !promo.getExpiresAt().isAfter(LocalDateTime.now())) {
            return reject(quote, Reason.EXPIRED, "This code has expired");
        }
        double minimum = promo.getMinOrderAmount() == null ? 0.0 : promo.getMinOrderAmount();
        if (subtotal < minimum) {
            double missing = roundCents(minimum - subtotal);
            quote.setMissingAmount(missing);
            return reject(quote, Reason.BELOW_MINIMUM,
                    "Add " + formatAmount(missing) + " AMD more to use this code");
        }

        // Discount base: the cart subtotal only, never the delivery fee (AC-2;
        // confirmed by the product owner over the conflicting KAN-28 note).
        double discount = roundCents(subtotal * promo.getPercentOff() / 100.0);
        quote.setApplies(true);
        quote.setDiscount(discount);
        quote.setTotal(roundCents(subtotal + deliveryPrice - discount));
        return quote;
    }

    private static PromoQuoteResponseDto reject(PromoQuoteResponseDto quote, Reason reason, String message) {
        quote.setApplies(false);
        quote.setReason(reason);
        quote.setMessage(message);
        return quote;
    }

    private static double roundCents(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    private static String formatAmount(double value) {
        return value == Math.floor(value)
                ? String.format(Locale.US, "%,d", (long) value)
                : String.format(Locale.US, "%,.2f", value);
    }
}

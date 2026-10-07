package am.foodme.backend.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class OrderReviewServiceTest {

    @Test
    void roundToOneDecimal_roundsHalfUp() {
        assertEquals(4.3, OrderReviewService.roundToOneDecimal(13.0 / 3));
        assertEquals(4.7, OrderReviewService.roundToOneDecimal(14.0 / 3));
        assertEquals(4.3, OrderReviewService.roundToOneDecimal(17.0 / 4));
        assertEquals(1.0, OrderReviewService.roundToOneDecimal(1.0));
        assertEquals(5.0, OrderReviewService.roundToOneDecimal(5.0));
    }

    @Test
    void roundToOneDecimal_nullStaysNull() {
        assertNull(OrderReviewService.roundToOneDecimal(null));
    }
}

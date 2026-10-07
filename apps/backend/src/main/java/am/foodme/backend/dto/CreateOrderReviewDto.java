package am.foodme.backend.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class CreateOrderReviewDto {

    private static final String RATING_MESSAGE = "Rating must be a whole number from 1 to 5";

    // BigDecimal rather than Integer: Jackson silently truncates 4.5 -> 4 when
    // binding into an int, which would accept a non-whole rating.
    @NotNull(message = RATING_MESSAGE)
    @DecimalMin(value = "1", message = RATING_MESSAGE)
    @DecimalMax(value = "5", message = RATING_MESSAGE)
    private BigDecimal rating;

    @Size(max = 1000, message = "Comment must be at most 1000 characters")
    private String comment;

    @JsonIgnore
    @AssertTrue(message = RATING_MESSAGE)
    public boolean isRatingWholeNumber() {
        return rating == null || rating.stripTrailingZeros().scale() <= 0;
    }
}

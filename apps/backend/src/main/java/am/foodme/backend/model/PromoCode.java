package am.foodme.backend.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

/** KAN-11: a percentage promo code. */
@Entity
@Table(name = "promo_code", schema = "foodme")
@Getter
@Setter
public class PromoCode {

    @Id
    @SequenceGenerator(name = "promo_code_id_seq", sequenceName = "foodme.promo_code_id_seq", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "promo_code_id_seq")
    @Column(name = "id", nullable = false)
    private Long id;

    /** Stored upper-case. */
    @Column(name = "code", nullable = false, unique = true, length = 64)
    private String code;

    @Column(name = "percent_off", nullable = false)
    private Integer percentOff;

    /** The cart subtotal must be at least this for the code to apply. */
    @Column(name = "min_order_amount", nullable = false)
    private Double minOrderAmount;

    /** Null means it never expires. */
    @Column(name = "expires_at")
    private LocalDateTime expiresAt;
}

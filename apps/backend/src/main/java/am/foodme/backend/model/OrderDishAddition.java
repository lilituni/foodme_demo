package am.foodme.backend.model;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;

@Entity
@Table(name = "order_dish_addition", schema = "foodme")
public class OrderDishAddition {

    // The column has no identity/default in V1__init.sql - ids come from this sequence.
    // (IDENTITY made every order with an extra fail on Postgres; H2 masked it.)
    @Id
    @SequenceGenerator(name = "order_dish_addition_id_seq", sequenceName = "foodme.order_dish_addition_id_seq", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "order_dish_addition_id_seq")
    private Long id;

    private String nameEn;
    private String nameAm;
    private String nameRu;
    private Double price;

    @ManyToOne
    @JoinColumn(name = "order_dish_id", nullable = false)
    private OrderDish orderDish;

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getNameEn() { return nameEn; }
    public void setNameEn(String nameEn) { this.nameEn = nameEn; }

    public String getNameAm() { return nameAm; }
    public void setNameAm(String nameAm) { this.nameAm = nameAm; }

    public String getNameRu() { return nameRu; }
    public void setNameRu(String nameRu) { this.nameRu = nameRu; }

    public Double getPrice() { return price; }
    public void setPrice(Double price) { this.price = price; }

    public OrderDish getOrderDish() { return orderDish; }
    public void setOrderDish(OrderDish orderDish) { this.orderDish = orderDish; }
}

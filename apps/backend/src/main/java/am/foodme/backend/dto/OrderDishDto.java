package am.foodme.backend.dto;

import am.foodme.backend.model.OrderDish;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import java.util.List;
import java.util.stream.Collectors;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class OrderDishDto {
    private List<OrderDishAdditionDto> additions;
    /** KAN-10: the menu dish this line was ordered from; null for legacy lines that can't be traced. */
    private Long dishId;
    private String nameEn;
    private String nameHy;
    private String nameRu;
    private Double price;
    private String url;
    private Integer quantity;

    public static OrderDishDto mapEntityToDto(OrderDish entity) {
        if (entity == null) {
            return null;
        }
        OrderDishDto dto = new OrderDishDto();
        dto.setDishId(entity.getDish() != null ? entity.getDish().getId() : null);
        dto.setNameEn(entity.getNameEn());
        dto.setNameHy(entity.getNameAm());
        dto.setNameRu(entity.getNameRu());
        dto.setPrice(entity.getPrice());
        dto.setUrl(entity.getUrl());
        dto.setQuantity(entity.getQuantity());
        if (entity.getAdditions() != null) {
            dto.setAdditions(entity.getAdditions().stream().map(a -> {
                OrderDishAdditionDto add = new OrderDishAdditionDto();
                add.setId(a.getId());
                add.setNameEn(a.getNameEn());
                add.setNameAm(a.getNameAm());
                add.setNameRu(a.getNameRu());
                add.setPrice(a.getPrice());
                return add;
            }).toList());
        }
        return dto;
    }
}

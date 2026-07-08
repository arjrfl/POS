from pydantic import BaseModel, ConfigDict


class PaymentMethodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    payment_method_name: str

"""HTTP input contract; clients supply model data, never server file paths."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Endpoint = Annotated[str, Field(min_length=3, max_length=512)]


class SimulationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    language_graph: dict[str, Any]
    model: dict[str, Any]
    entry_points: list[Endpoint] = Field(min_length=1, max_length=200)
    goals: list[Endpoint] = Field(min_length=1, max_length=200)
    attacker_type: Literal["BreadthFirstAttacker", "DepthFirstAttacker"]
    seed: int = Field(default=0, ge=0, le=2**32 - 1)
    max_steps: int = Field(default=10000, ge=1, le=100000)

    @field_validator("entry_points", "goals")
    @classmethod
    def validate_endpoints(cls, values):
        for value in values:
            asset, separator, step = value.rpartition(":")
            if not separator or not asset.strip() or not step.strip():
                raise ValueError("Endpoints must use AssetName:attackStep format.")
        return list(dict.fromkeys(values))

    @model_validator(mode="after")
    def validate_model(self):
        assets = self.model.get("assets")
        if not isinstance(assets, dict) or not assets:
            raise ValueError("The MAL model must contain assets.")
        if len(assets) > 10000:
            raise ValueError("The model exceeds the 10,000 asset limit.")
        names = [asset.get("name") for asset in assets.values() if isinstance(asset, dict)]
        if len(names) != len(assets) or any(not isinstance(name, str) or not name for name in names):
            raise ValueError("Every asset must have a name.")
        if len(set(names)) != len(names):
            raise ValueError("Model asset names must be unique.")
        for endpoint in self.entry_points + self.goals:
            if endpoint.rpartition(":")[0] not in names:
                raise ValueError(f"Endpoint asset is missing from the model: {endpoint}")
        metadata = self.language_graph.get("metadata")
        model_metadata = self.model.get("metadata")
        if not isinstance(metadata, dict) or not isinstance(model_metadata, dict):
            raise ValueError("Model and LangGraph metadata must be objects.")
        if not isinstance(model_metadata.get("name"), str) or not model_metadata["name"].strip():
            raise ValueError("The model metadata must include a name.")
        for model_key, language_key in (("langID", "id"), ("langVersion", "version")):
            if not metadata.get(language_key) or str(model_metadata.get(model_key)) != str(metadata[language_key]):
                raise ValueError(f"Model {model_key} must match the attached LangGraph.")
        return self

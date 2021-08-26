import { IBaseStep } from "./base-step.interface";

export interface IPayloadStep extends IBaseStep {
  payloadLength: number;
}

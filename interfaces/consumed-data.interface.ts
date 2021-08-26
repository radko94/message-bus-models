import { IBaseStep } from "./base-step.interface";

export interface IConsumedDataStep extends IBaseStep {
  consumedData: Buffer;
}

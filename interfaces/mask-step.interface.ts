import { IBaseStep } from "./base-step.interface";

export interface IMaskStep extends IBaseStep {
  mask: Buffer;
}

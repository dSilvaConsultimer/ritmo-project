import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

export interface Income {
  readonly id: Id<"income">;
  readonly label: string;
  /** Gross monthly amount, before taxes. */
  readonly grossAmount: Money;
  readonly certainty: Certainty;
  readonly recurring: boolean;
}

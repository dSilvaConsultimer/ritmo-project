import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type {
  FinancialEvent,
  FinancialGoal,
  FinancialProfile,
  FinancialSnapshotInput,
  FixedExpense,
  Income,
  InstallmentPlan,
  LifestyleScenario,
  PaymentSource,
  ProtectedPreference,
  ReconciliationLink,
  VariableBudget,
  Category,
  CategoryRule,
  MerchantNormalizationRule,
  FinancialTransaction,
  FinancialPosition,
  ProviderConnection,
  SyncRun,
  CreditCardBill,
  Recommendation,
  LiquidityCoverage,
  RecurringExpenseCandidate,
} from "@money-copilot/financial-engine";
import type { AIRequestLog, AIToolExecution, Conversation, ConversationMessage } from "@money-copilot/ai";
import { createId } from "@money-copilot/shared";
import type { Database } from "./db";
import * as schema from "./schema";
import * as mappers from "./mappers";

/**
 * Every upsert in this module is idempotent by primary key
 * (`onConflictDoUpdate`) — running the seed script (or any of these) twice
 * never duplicates a row. See `seed.ts` and its "idempotent seed" test.
 */

export async function upsertProfile(db: Database, profile: FinancialProfile): Promise<void> {
  await db
    .insert(schema.financialProfiles)
    .values(profile)
    .onConflictDoUpdate({ target: schema.financialProfiles.id, set: profile });
}

/**
 * Looks up a profile by id — used by connection recovery (Sprint 4.5) to
 * validate that a Pluggy Item's `clientUserId` corresponds to a real,
 * known profile before attributing a connection to it, rather than
 * trusting the value blindly. See `app-services/src/sync.ts`,
 * `recoverOrphanedConnection`.
 */
export async function getProfileById(db: Database, id: string): Promise<FinancialProfile | undefined> {
  const [row] = await db.select().from(schema.financialProfiles).where(eq(schema.financialProfiles.id, id));
  return row as FinancialProfile | undefined;
}

/**
 * Sprint 9: the ownership lookup `apps/ritmo/src/functions/profile-context.ts`
 * uses to resolve an authenticated Better Auth `user.id` to its
 * `FinancialProfile` — the one supported way a request's identity becomes a
 * `financialProfileId` anywhere downstream.
 */
export async function getProfileByOwnerUserId(
  db: Database,
  ownerUserId: string,
): Promise<FinancialProfile | undefined> {
  const [row] = await db
    .select()
    .from(schema.financialProfiles)
    .where(eq(schema.financialProfiles.ownerUserId, ownerUserId));
  return row ? ({ id: row.id, label: row.label, createdAt: row.createdAt } as FinancialProfile) : undefined;
}

/**
 * Idempotent, race-safe provisioning: a Better Auth user's FIRST successful
 * login creates exactly one `FinancialProfile` for them. The `owner_user_id`
 * column's UNIQUE constraint (schema.ts) is what makes this safe under
 * concurrent requests — `onConflictDoNothing` means at most one INSERT ever
 * actually lands for a given owner; `.returning()` tells each caller whether
 * ITS OWN insert was the one that won, so a `FinancialGoal` (see below) is
 * only ever created once, not once per login.
 *
 * Also creates a minimal placeholder `FinancialGoal` — but ONLY the first
 * time, when the profile itself is genuinely new.
 * `loadFinancialSnapshotInput` hard-requires exactly one goal per profile
 * (throws otherwise; this is an existing financial-engine invariant, not
 * something Sprint 9 changes) — a zero monthly-savings-target, honestly
 * labeled "no goal set yet," satisfies that invariant without fabricating
 * an aspirational number the user never actually stated (brief §11: a real
 * user never receives fabricated financial data). See docs/DECISIONS.md
 * DEC-096.
 */
export async function provisionProfileForOwner(
  db: Database,
  ownerUserId: string,
  label: string,
  createdAt: string,
): Promise<FinancialProfile> {
  const candidate: FinancialProfile = { id: createId("financial-profile"), label, createdAt };
  const inserted = await db
    .insert(schema.financialProfiles)
    .values({ ...candidate, ownerUserId })
    .onConflictDoNothing({ target: schema.financialProfiles.ownerUserId })
    .returning();

  if (inserted.length > 0) {
    await db.insert(schema.financialGoals).values({
      id: createId("financial-goal"),
      financialProfileId: candidate.id,
      label: "Sem meta definida",
      monthlySavingsTargetCents: 0,
    });
    return candidate;
  }

  const existing = await getProfileByOwnerUserId(db, ownerUserId);
  if (!existing) {
    throw new Error(`Failed to provision or find a profile for owner ${ownerUserId}`);
  }
  return existing;
}

/**
 * Finds a previously-synced payment source by its provider + external
 * account id — used by the sync pipeline to decide whether to update an
 * existing `PaymentSource` row or create a new one (provider accounts have
 * no stable *internal* id until the first sync creates one).
 */
export async function findPaymentSourceByExternalId(
  db: Database,
  financialProfileId: string,
  provider: string,
  externalAccountId: string,
): Promise<PaymentSource | undefined> {
  const [row] = await db
    .select()
    .from(schema.paymentSources)
    .where(
      and(
        eq(schema.paymentSources.financialProfileId, financialProfileId),
        eq(schema.paymentSources.provider, provider),
        eq(schema.paymentSources.externalAccountId, externalAccountId),
      ),
    );
  return row ? mappers.rowToPaymentSource(row) : undefined;
}

/**
 * DEC-131: conflict-safe upsert on the CANONICAL provider-account identity
 * (financialProfileId, provider, externalAccountId) — not just the row's own
 * `id` — so two concurrent/overlapping syncs of the same provider account
 * can never both insert. Both racing INSERTs hit the database's own unique
 * constraint (see `schema.ts`'s `paymentSources` table); whichever commits
 * second falls through to `DO UPDATE` on the row the first one created,
 * rather than creating a second row (the ON CONFLICT target's own columns,
 * `id` included, are deliberately excluded from the `set` clause — the
 * primary key of the row that already exists must never be overwritten).
 *
 * A manually-entered payment source (`provider`/`externalAccountId` both
 * null) can never trigger this constraint at all — standard Postgres
 * unique-constraint NULL semantics treat every null as distinct — so it
 * falls back to the previous `id`-keyed upsert, unaffected.
 *
 * Returns the row actually persisted (which may have a DIFFERENT `id` than
 * `paymentSource.id` when this call lost a race) — callers MUST use the
 * returned value, never the input, for anything referencing this payment
 * source afterward (e.g. attaching imported transactions) — see
 * `syncConnection` in `@money-copilot/app-services`.
 */
export async function upsertPaymentSource(
  db: Database,
  paymentSource: PaymentSource,
  financialProfileId: string,
): Promise<PaymentSource> {
  const row = mappers.paymentSourceToRow(paymentSource, financialProfileId);
  const { id: _id, ...rowWithoutId } = row;
  const isProviderIdentified = row.provider !== null && row.externalAccountId !== null;

  const [saved] = isProviderIdentified
    ? await db
        .insert(schema.paymentSources)
        .values(row)
        .onConflictDoUpdate({
          target: [
            schema.paymentSources.financialProfileId,
            schema.paymentSources.provider,
            schema.paymentSources.externalAccountId,
          ],
          set: rowWithoutId,
        })
        .returning()
    : await db
        .insert(schema.paymentSources)
        .values(row)
        .onConflictDoUpdate({ target: schema.paymentSources.id, set: row })
        .returning();

  return mappers.rowToPaymentSource(saved!);
}

export async function listPaymentSourcesForProfile(
  db: Database,
  financialProfileId: string,
): Promise<PaymentSource[]> {
  const rows = await db
    .select()
    .from(schema.paymentSources)
    .where(eq(schema.paymentSources.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToPaymentSource);
}

export async function upsertIncome(db: Database, income: Income, financialProfileId: string): Promise<void> {
  const row = mappers.incomeToRow(income, financialProfileId);
  await db.insert(schema.incomes).values(row).onConflictDoUpdate({ target: schema.incomes.id, set: row });
}

export async function upsertFixedExpense(
  db: Database,
  expense: FixedExpense,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.fixedExpenseToRow(expense, financialProfileId);
  await db
    .insert(schema.fixedExpenses)
    .values(row)
    .onConflictDoUpdate({ target: schema.fixedExpenses.id, set: row });
}

export async function upsertVariableBudget(
  db: Database,
  budget: VariableBudget,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.variableBudgetToRow(budget, financialProfileId);
  await db
    .insert(schema.variableBudgets)
    .values(row)
    .onConflictDoUpdate({ target: schema.variableBudgets.id, set: row });
}

export async function upsertTransaction(db: Database, transaction: FinancialTransaction): Promise<void> {
  const row = mappers.transactionToRow(transaction);
  await db
    .insert(schema.financialTransactions)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialTransactions.id, set: row });
}

/** Finds a previously-imported transaction by provider + external transaction id. */
export async function findTransactionByExternalId(
  db: Database,
  financialProfileId: string,
  provider: string,
  externalTransactionId: string,
): Promise<FinancialTransaction | undefined> {
  const [row] = await db
    .select()
    .from(schema.financialTransactions)
    .where(
      and(
        eq(schema.financialTransactions.financialProfileId, financialProfileId),
        eq(schema.financialTransactions.externalProviderId, provider),
        eq(schema.financialTransactions.externalTransactionId, externalTransactionId),
      ),
    );
  if (!row) return undefined;
  const [paymentSourceRow] = await db
    .select()
    .from(schema.paymentSources)
    .where(eq(schema.paymentSources.id, row.paymentSourceId));
  if (!paymentSourceRow) return undefined;
  return mappers.rowToTransaction(row, mappers.rowToPaymentSource(paymentSourceRow));
}

/** Loads a single transaction by its own internal id, with its full `PaymentSource` embedded — see `findTransactionByExternalId`. */
export async function getTransactionById(
  db: Database,
  transactionId: string,
): Promise<FinancialTransaction | undefined> {
  const [row] = await db
    .select()
    .from(schema.financialTransactions)
    .where(eq(schema.financialTransactions.id, transactionId));
  if (!row) return undefined;
  const [paymentSourceRow] = await db
    .select()
    .from(schema.paymentSources)
    .where(eq(schema.paymentSources.id, row.paymentSourceId));
  if (!paymentSourceRow) return undefined;
  return mappers.rowToTransaction(row, mappers.rowToPaymentSource(paymentSourceRow));
}

/**
 * Cheap existence check — never loads a transaction row, just whether at
 * least one exists for this payment source (DEC-128: used by `syncConnection`
 * to decide whether a payment source's incremental `since` watermark can be
 * trusted, or whether it must be treated as never-yet-baselined and given a
 * full pull instead). `limit(1)` so a payment source with thousands of
 * transactions costs the same as one with none.
 */
export async function hasAnyTransactionForPaymentSource(
  db: Database,
  paymentSourceId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.financialTransactions.id })
    .from(schema.financialTransactions)
    .where(eq(schema.financialTransactions.paymentSourceId, paymentSourceId))
    .limit(1);
  return rows.length > 0;
}

export async function markTransactionReversed(db: Database, transactionId: string, updatedAt: string): Promise<void> {
  await db
    .update(schema.financialTransactions)
    .set({ status: "REVERSED", updatedAt })
    .where(eq(schema.financialTransactions.id, transactionId));
}

export async function upsertEvent(db: Database, event: FinancialEvent, financialProfileId: string): Promise<void> {
  const row = mappers.eventToRow(event, financialProfileId);
  await db
    .insert(schema.financialEvents)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialEvents.id, set: row });
  for (const item of event.lineItems) {
    const itemRow = mappers.lineItemToRow(item, event.id);
    await db
      .insert(schema.financialEventLineItems)
      .values(itemRow)
      .onConflictDoUpdate({ target: schema.financialEventLineItems.id, set: itemRow });
  }
}

export async function upsertInstallmentPlan(db: Database, plan: InstallmentPlan): Promise<void> {
  const row = mappers.installmentPlanToRow(plan);
  await db
    .insert(schema.installmentPlans)
    .values(row)
    .onConflictDoUpdate({ target: schema.installmentPlans.id, set: row });
}

export async function upsertReconciliationLink(db: Database, link: ReconciliationLink): Promise<void> {
  const row = mappers.reconciliationLinkToRow(link);
  await db
    .insert(schema.reconciliationLinks)
    .values(row)
    .onConflictDoUpdate({ target: schema.reconciliationLinks.id, set: row });
}

/**
 * All reconciliation links for one profile — was global across every
 * profile until Sprint 9 (DEC-091) added `financial_profile_id`; every
 * caller must only ever see/dedupe against its OWN profile's links.
 */
export async function listReconciliationLinksForProfile(
  db: Database,
  financialProfileId: string,
): Promise<ReconciliationLink[]> {
  const rows = await db
    .select()
    .from(schema.reconciliationLinks)
    .where(eq(schema.reconciliationLinks.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToReconciliationLink);
}

export async function listInstallmentPlansForProfile(
  db: Database,
  financialProfileId: string,
): Promise<InstallmentPlan[]> {
  const rows = await db
    .select()
    .from(schema.installmentPlans)
    .where(eq(schema.installmentPlans.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToInstallmentPlan);
}

export async function findInstallmentPlanByOriginTransactionId(
  db: Database,
  originTransactionId: string,
): Promise<InstallmentPlan | undefined> {
  const [row] = await db
    .select()
    .from(schema.installmentPlans)
    .where(eq(schema.installmentPlans.originTransactionId, originTransactionId));
  return row ? mappers.rowToInstallmentPlan(row) : undefined;
}

export async function upsertGoal(db: Database, goal: FinancialGoal, financialProfileId: string): Promise<void> {
  const row = mappers.goalToRow(goal, financialProfileId);
  await db
    .insert(schema.financialGoals)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialGoals.id, set: row });
}

export async function upsertProtectedPreference(
  db: Database,
  preference: ProtectedPreference,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.protectedPreferenceToRow(preference, financialProfileId);
  await db
    .insert(schema.protectedPreferences)
    .values(row)
    .onConflictDoUpdate({ target: schema.protectedPreferences.id, set: row });
}

export async function upsertLifestyleScenario(
  db: Database,
  scenario: LifestyleScenario,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.lifestyleScenarioToRow(scenario, financialProfileId);
  await db
    .insert(schema.lifestyleScenarios)
    .values(row)
    .onConflictDoUpdate({ target: schema.lifestyleScenarios.id, set: row });
  for (const delta of scenario.additionalMonthlyExpenses) {
    const deltaRow = mappers.lifestyleDeltaToRow(delta, scenario.id);
    await db
      .insert(schema.lifestyleDeltas)
      .values(deltaRow)
      .onConflictDoUpdate({ target: schema.lifestyleDeltas.id, set: deltaRow });
  }
}

export async function upsertPosition(db: Database, position: FinancialPosition): Promise<void> {
  const row = mappers.positionToRow(position);
  await db
    .insert(schema.financialPositions)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialPositions.id, set: row });
}

export async function upsertMerchantRule(db: Database, rule: MerchantNormalizationRule): Promise<void> {
  const row = mappers.merchantRuleToRow(rule);
  await db
    .insert(schema.merchantNormalizationRules)
    .values(row)
    .onConflictDoUpdate({ target: schema.merchantNormalizationRules.id, set: row });
}

/** Id-keyed upsert — used only for global `SYSTEM_DEFAULT` rules (`seed.ts`'s stable fixture ids). Never use this for a personal rule — see `upsertPersonalCategoryRule`. */
export async function upsertCategoryRule(db: Database, rule: CategoryRule): Promise<void> {
  const row = mappers.categoryRuleToRow(rule);
  await db
    .insert(schema.categoryRules)
    .values(row)
    .onConflictDoUpdate({ target: schema.categoryRules.id, set: row });
}

/**
 * DEC-133/134: conflict-safe upsert for a PERSONAL rule, keyed on its
 * natural identity `(financialProfileId, matchType, pattern)` — mirrors
 * the DEC-131 PaymentSource fix exactly, and satisfies "create or UPDATE
 * the profile-scoped personal rule" (correcting the same merchant twice
 * updates the existing rule rather than creating a duplicate).
 * `rule.financialProfileId` MUST be set — this function is never valid for
 * a global `SYSTEM_DEFAULT` rule. `targetWhere` mirrors the PARTIAL unique
 * index's own predicate exactly (DEC-134) — Postgres requires the conflict
 * inference clause to match a partial index's predicate verbatim, or it
 * cannot infer which index this upsert means to use.
 */
export async function upsertPersonalCategoryRule(db: Database, rule: CategoryRule): Promise<CategoryRule> {
  if (rule.financialProfileId === undefined) {
    throw new Error("upsertPersonalCategoryRule requires rule.financialProfileId — use upsertCategoryRule for global rules");
  }
  const row = mappers.categoryRuleToRow(rule);
  const { id: _id, ...refreshableFields } = row;
  const [saved] = await db
    .insert(schema.categoryRules)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.categoryRules.financialProfileId, schema.categoryRules.matchType, schema.categoryRules.pattern],
      targetWhere: sql`${schema.categoryRules.financialProfileId} IS NOT NULL`,
      set: refreshableFields,
    })
    .returning();
  return mappers.rowToCategoryRule(saved!);
}

export async function getCategoryRuleById(db: Database, id: string): Promise<CategoryRule | undefined> {
  const [row] = await db.select().from(schema.categoryRules).where(eq(schema.categoryRules.id, id));
  return row ? mappers.rowToCategoryRule(row) : undefined;
}

/** DEC-132/133: only ever deletes a USER-authored, profile-owned rule — callers (`mutations.deleteCategoryRule`) enforce that, never this layer alone. */
export async function deleteCategoryRule(db: Database, id: string): Promise<void> {
  await db.delete(schema.categoryRules).where(eq(schema.categoryRules.id, id));
}

export async function deleteMerchantRule(db: Database, id: string): Promise<void> {
  await db.delete(schema.merchantNormalizationRules).where(eq(schema.merchantNormalizationRules.id, id));
}

// ---------- Category (DEC-135) ----------

/** Id-keyed upsert — used only for global BASE categories (`seed`/bootstrap's stable fixture ids). Never use this for a personal category — see `upsertPersonalCategory`. */
export async function upsertCategory(db: Database, category: Category): Promise<void> {
  const row = mappers.categoryToRow(category);
  await db.insert(schema.categories).values(row).onConflictDoUpdate({ target: schema.categories.id, set: row });
}

/**
 * Conflict-safe upsert for a PERSONAL category, keyed on its natural
 * identity `(financialProfileId, name)` — mirrors
 * `upsertPersonalCategoryRule` (DEC-133/134) exactly. `category.financialProfileId`
 * MUST be set. `targetWhere` matches the partial unique index's own
 * predicate — required for Postgres to infer which index this upsert means.
 */
export async function upsertPersonalCategory(db: Database, category: Category): Promise<Category> {
  if (category.financialProfileId === undefined) {
    throw new Error("upsertPersonalCategory requires category.financialProfileId — use upsertCategory for base categories");
  }
  const row = mappers.categoryToRow(category);
  const { id: _id, ...refreshableFields } = row;
  const [saved] = await db
    .insert(schema.categories)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.categories.financialProfileId, schema.categories.name],
      targetWhere: sql`${schema.categories.financialProfileId} IS NOT NULL`,
      set: refreshableFields,
    })
    .returning();
  return mappers.rowToCategory(saved!);
}

export async function getCategoryById(db: Database, id: string): Promise<Category | undefined> {
  const [row] = await db.select().from(schema.categories).where(eq(schema.categories.id, id));
  return row ? mappers.rowToCategory(row) : undefined;
}

/**
 * Every category VISIBLE to this profile — every BASE category
 * (`financial_profile_id IS NULL`) plus this profile's own PERSONAL ones.
 * Never another profile's personal categories. Mirrors `loadRules`'s own
 * visibility rule exactly.
 */
export async function listCategoriesForProfile(db: Database, financialProfileId: string): Promise<Category[]> {
  const rows = await db
    .select()
    .from(schema.categories)
    .where(or(isNull(schema.categories.financialProfileId), eq(schema.categories.financialProfileId, financialProfileId)));
  return rows.map(mappers.rowToCategory);
}

/** Every global BASE category (`financial_profile_id IS NULL`) — never any profile's personal ones. */
export async function listBaseCategories(db: Database): Promise<Category[]> {
  const rows = await db.select().from(schema.categories).where(isNull(schema.categories.financialProfileId));
  return rows.map(mappers.rowToCategory);
}

/**
 * DEC-135: every `CategoryRule` regardless of ownership — global AND every
 * profile's personal ones. Migration-only use (`backfillCategoryRuleCategoryIds`);
 * every ordinary read path stays scoped through `loadRules` instead.
 */
export async function listAllCategoryRules(db: Database): Promise<CategoryRule[]> {
  const rows = await db.select().from(schema.categoryRules);
  return rows.map(mappers.rowToCategoryRule);
}

// ---------- RecurringExpenseCandidate (DEC-132) ----------

/**
 * Conflict-safe upsert on the candidate's natural identity
 * (financialProfileId, kind, evidenceKey) — mirrors the DEC-131
 * PaymentSource fix exactly, for the same reason: two overlapping
 * detection runs for the same profile must never create two rows for the
 * same evidence. Returns the row actually persisted (its `id`/`status`
 * survive across re-detections; only the evidence numbers refresh).
 */
export async function upsertRecurringCandidate(
  db: Database,
  candidate: RecurringExpenseCandidate,
  financialProfileId: string,
  kind: "INCOME" | "FIXED_EXPENSE",
): Promise<RecurringExpenseCandidate> {
  const row = mappers.recurringCandidateToRow(candidate, financialProfileId, kind);
  const { id: _id, status: _status, createdAt: _createdAt, ...refreshableFields } = row;
  const [saved] = await db
    .insert(schema.recurringCandidates)
    .values(row)
    .onConflictDoUpdate({
      target: [
        schema.recurringCandidates.financialProfileId,
        schema.recurringCandidates.kind,
        schema.recurringCandidates.evidenceKey,
      ],
      // Never overwrite `id`, `status`, or `createdAt` of an existing
      // candidate — only the evidence numbers (occurrences/amount/interval/
      // confidence) refresh on re-detection. A user's CONFIRMED/REJECTED
      // decision must never be silently reset back to CANDIDATE.
      set: refreshableFields,
    })
    .returning();
  return mappers.rowToRecurringCandidate(saved!);
}

export async function listRecurringCandidatesForProfile(
  db: Database,
  financialProfileId: string,
  kind: "INCOME" | "FIXED_EXPENSE",
): Promise<RecurringExpenseCandidate[]> {
  const rows = await db
    .select()
    .from(schema.recurringCandidates)
    .where(
      and(
        eq(schema.recurringCandidates.financialProfileId, financialProfileId),
        eq(schema.recurringCandidates.kind, kind),
      ),
    );
  return rows.map(mappers.rowToRecurringCandidate);
}

export async function getRecurringCandidateById(
  db: Database,
  id: string,
): Promise<RecurringExpenseCandidate | undefined> {
  const [row] = await db.select().from(schema.recurringCandidates).where(eq(schema.recurringCandidates.id, id));
  return row ? mappers.rowToRecurringCandidate(row) : undefined;
}

export async function updateRecurringCandidateStatus(
  db: Database,
  id: string,
  status: "CONFIRMED" | "REJECTED",
): Promise<void> {
  await db.update(schema.recurringCandidates).set({ status }).where(eq(schema.recurringCandidates.id, id));
}

// ---------- Loading a full FinancialSnapshotInput back out ----------

export async function loadFinancialSnapshotInput(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<FinancialSnapshotInput> {
  const [incomeRows, fixedExpenseRows, variableBudgetRows, goalRows, preferenceRows, transactionRows, paymentSourceRows, eventRows, installmentPlanRows, linkRows, positionRows] =
    await Promise.all([
      db.select().from(schema.incomes).where(eq(schema.incomes.financialProfileId, financialProfileId)),
      db.select().from(schema.fixedExpenses).where(eq(schema.fixedExpenses.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.variableBudgets)
        .where(eq(schema.variableBudgets.financialProfileId, financialProfileId)),
      db.select().from(schema.financialGoals).where(eq(schema.financialGoals.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.protectedPreferences)
        .where(eq(schema.protectedPreferences.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.financialTransactions)
        .where(eq(schema.financialTransactions.financialProfileId, financialProfileId)),
      db.select().from(schema.paymentSources).where(eq(schema.paymentSources.financialProfileId, financialProfileId)),
      db.select().from(schema.financialEvents).where(eq(schema.financialEvents.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.installmentPlans)
        .where(eq(schema.installmentPlans.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.reconciliationLinks)
        .where(eq(schema.reconciliationLinks.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.financialPositions)
        .where(eq(schema.financialPositions.financialProfileId, financialProfileId)),
    ]);

  const paymentSourceById = new Map(paymentSourceRows.map((r) => [r.id, mappers.rowToPaymentSource(r)]));

  const eventIds = eventRows.map((e) => e.id);
  const lineItemRows = eventIds.length
    ? await db
        .select()
        .from(schema.financialEventLineItems)
        .where(inArray(schema.financialEventLineItems.financialEventId, eventIds))
    : [];

  const events = eventRows.map((row) =>
    mappers.rowsToEvent(
      row,
      lineItemRows.filter((li) => li.financialEventId === row.id),
    ),
  );

  const transactions = transactionRows.map((row) => {
    const paymentSource = paymentSourceById.get(row.paymentSourceId);
    if (!paymentSource) {
      throw new Error(`Transaction ${row.id} references unknown payment source ${row.paymentSourceId}`);
    }
    return mappers.rowToTransaction(row, paymentSource);
  });

  if (goalRows.length === 0 || goalRows[0] === undefined) {
    throw new Error(`No FinancialGoal found for profile ${financialProfileId}`);
  }

  return {
    asOfDate,
    income: incomeRows.map(mappers.rowToIncome),
    fixedExpenses: fixedExpenseRows.map(mappers.rowToFixedExpense),
    variableBudgets: variableBudgetRows.map(mappers.rowToVariableBudget),
    transactions,
    reconciliationLinks: linkRows.map(mappers.rowToReconciliationLink),
    events,
    installmentPlans: installmentPlanRows.map(mappers.rowToInstallmentPlan),
    goal: mappers.rowToGoal(goalRows[0]),
    protectedPreferences: preferenceRows.map(mappers.rowToProtectedPreference),
    ...(positionRows[0] ? { position: mappers.rowToPosition(positionRows[0]) } : {}),
  };
}

/** Loads the CURRENT_LIFESTYLE and INDEPENDENT_LIVING scenarios for a profile, if present. */
export async function loadLifestyleScenarios(
  db: Database,
  financialProfileId: string,
): Promise<{ current: LifestyleScenario | undefined; independent: LifestyleScenario | undefined }> {
  const scenarioRows = await db
    .select()
    .from(schema.lifestyleScenarios)
    .where(eq(schema.lifestyleScenarios.financialProfileId, financialProfileId));

  const scenarioIds = scenarioRows.map((r) => r.id);
  const deltaRows = scenarioIds.length
    ? await db
        .select()
        .from(schema.lifestyleDeltas)
        .where(inArray(schema.lifestyleDeltas.lifestyleScenarioId, scenarioIds))
    : [];

  const scenarios = scenarioRows.map((row) =>
    mappers.rowsToLifestyleScenario(
      row,
      deltaRows.filter((d) => d.lifestyleScenarioId === row.id),
    ),
  );

  return {
    current: scenarios.find((s) => s.type === "CURRENT_LIFESTYLE"),
    independent: scenarios.find((s) => s.type === "INDEPENDENT_LIVING"),
  };
}

/** Loads merchant normalization and categorization rules (global, not per-profile). */
/**
 * DEC-133: `categoryRules` returns every rule VISIBLE to this profile — the
 * global `SYSTEM_DEFAULT` set (`financial_profile_id IS NULL`) plus this
 * profile's own personal overrides. Never another profile's personal rules
 * — see `categorize`'s own precedence doc comment for how ties between the
 * two tiers resolve. `merchantRules` (normalization, not categorization)
 * remain global-only — unaffected by DEC-133, unchanged from before.
 */
export async function loadRules(
  db: Database,
  financialProfileId: string,
): Promise<{ merchantRules: MerchantNormalizationRule[]; categoryRules: CategoryRule[] }> {
  const [merchantRuleRows, categoryRuleRows] = await Promise.all([
    db.select().from(schema.merchantNormalizationRules),
    db
      .select()
      .from(schema.categoryRules)
      .where(
        or(
          isNull(schema.categoryRules.financialProfileId),
          eq(schema.categoryRules.financialProfileId, financialProfileId),
        ),
      ),
  ]);
  return {
    merchantRules: merchantRuleRows.map(mappers.rowToMerchantRule),
    categoryRules: categoryRuleRows.map(mappers.rowToCategoryRule),
  };
}

// ---------- ProviderConnection ----------

export async function upsertProviderConnection(db: Database, connection: ProviderConnection): Promise<void> {
  const row = mappers.providerConnectionToRow(connection);
  await db
    .insert(schema.providerConnections)
    .values(row)
    .onConflictDoUpdate({ target: schema.providerConnections.id, set: row });
}

/**
 * Finds an existing connection for this (profile, provider, external id)
 * triple — the check that avoids creating a duplicate connection when the
 * same real-world Item is connected more than once. See RULE (Sprint 3):
 * "avoid duplicate provider connections where possible."
 */
export async function findProviderConnection(
  db: Database,
  financialProfileId: string,
  provider: string,
  externalConnectionId: string,
): Promise<ProviderConnection | undefined> {
  const [row] = await db
    .select()
    .from(schema.providerConnections)
    .where(
      and(
        eq(schema.providerConnections.financialProfileId, financialProfileId),
        eq(schema.providerConnections.provider, provider),
        eq(schema.providerConnections.externalConnectionId, externalConnectionId),
      ),
    );
  return row ? mappers.rowToProviderConnection(row) : undefined;
}

export async function listProviderConnections(
  db: Database,
  financialProfileId: string,
): Promise<ProviderConnection[]> {
  const rows = await db
    .select()
    .from(schema.providerConnections)
    .where(eq(schema.providerConnections.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToProviderConnection);
}

export async function getProviderConnectionById(
  db: Database,
  id: string,
): Promise<ProviderConnection | undefined> {
  const [row] = await db.select().from(schema.providerConnections).where(eq(schema.providerConnections.id, id));
  return row ? mappers.rowToProviderConnection(row) : undefined;
}

/**
 * Finds a connection by provider + external id ALONE (no profile filter) —
 * used by webhook processing, which only knows the provider's own
 * `itemId`, not which internal profile it belongs to.
 */
export async function findProviderConnectionByExternalId(
  db: Database,
  provider: string,
  externalConnectionId: string,
): Promise<ProviderConnection | undefined> {
  const [row] = await db
    .select()
    .from(schema.providerConnections)
    .where(
      and(
        eq(schema.providerConnections.provider, provider),
        eq(schema.providerConnections.externalConnectionId, externalConnectionId),
      ),
    );
  return row ? mappers.rowToProviderConnection(row) : undefined;
}

// ---------- Bills ----------

export async function upsertBill(db: Database, bill: CreditCardBill): Promise<void> {
  const row = mappers.billToRow(bill);
  await db.insert(schema.bills).values(row).onConflictDoUpdate({ target: schema.bills.id, set: row });
}

/**
 * Finds a previously-imported bill by provider + external bill id — used
 * by the sync pipeline to reuse the existing internal id (matching the
 * `findTransactionByExternalId`/`findPaymentSourceByExternalId` pattern)
 * rather than creating a duplicate row on every sync. See DEC-048.
 */
export async function findBillByExternalId(
  db: Database,
  provider: string,
  externalBillId: string,
): Promise<CreditCardBill | undefined> {
  const [row] = await db
    .select()
    .from(schema.bills)
    .where(and(eq(schema.bills.provider, provider), eq(schema.bills.externalBillId, externalBillId)));
  return row ? mappers.rowToBill(row) : undefined;
}

export async function listBillsForPaymentSource(
  db: Database,
  paymentSourceId: string,
): Promise<CreditCardBill[]> {
  const rows = await db.select().from(schema.bills).where(eq(schema.bills.paymentSourceId, paymentSourceId));
  return rows.map(mappers.rowToBill);
}

export async function listBillsForProfile(db: Database, financialProfileId: string): Promise<CreditCardBill[]> {
  const rows = await db.select().from(schema.bills).where(eq(schema.bills.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToBill);
}

// ---------- SyncRun ----------

export async function upsertSyncRun(db: Database, run: SyncRun): Promise<void> {
  const row = mappers.syncRunToRow(run);
  await db.insert(schema.syncRuns).values(row).onConflictDoUpdate({ target: schema.syncRuns.id, set: row });
}

export async function getLatestSyncRun(db: Database, connectionId: string): Promise<SyncRun | undefined> {
  const [row] = await db
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.connectionId, connectionId))
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(1);
  return row ? mappers.rowToSyncRun(row) : undefined;
}

/**
 * Sprint 7: the most recent `limit` sync runs for one connection, most
 * recent first — used by the alert engine's `evaluateConnectionAttention`
 * to count CONSECUTIVE non-`SUCCEEDED` runs (a real, historical signal for
 * "repeated failure," never a single transient blip). See
 * docs/ALERTS-NOTIFICATIONS.md, "Connection health alert."
 */
export async function listRecentSyncRunsForConnection(
  db: Database,
  connectionId: string,
  limit = 5,
): Promise<SyncRun[]> {
  const rows = await db
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.connectionId, connectionId))
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(limit);
  return rows.map(mappers.rowToSyncRun);
}

// ---------- Webhook idempotency ----------

export type WebhookInsertResult = "INSERTED" | "ALREADY_PROCESSED";

/**
 * Attempts to claim a webhook event id for processing. Returns
 * `ALREADY_PROCESSED` (without throwing) when a row for this `eventId`
 * already exists — the `INSERT ... ON CONFLICT DO NOTHING` + row-count
 * check IS the entire idempotency mechanism (see schema.ts,
 * `webhookEvents`). Callers must skip processing when this returns
 * `ALREADY_PROCESSED`.
 */
export async function claimWebhookEvent(
  db: Database,
  eventId: string,
  provider: string,
  event: string,
  receivedAt: string,
  payloadSummary: Record<string, unknown>,
): Promise<WebhookInsertResult> {
  const result = await db
    .insert(schema.webhookEvents)
    .values({
      id: eventId,
      provider,
      event,
      receivedAt,
      status: "RECEIVED",
      payloadSummary: JSON.stringify(payloadSummary),
    })
    .onConflictDoNothing({ target: schema.webhookEvents.id })
    .returning({ id: schema.webhookEvents.id });

  return result.length > 0 ? "INSERTED" : "ALREADY_PROCESSED";
}

export async function markWebhookEventProcessed(
  db: Database,
  eventId: string,
  processedAt: string,
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status: "PROCESSED", processedAt })
    .where(eq(schema.webhookEvents.id, eventId));
}

export async function markWebhookEventFailed(
  db: Database,
  eventId: string,
  processedAt: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status: "FAILED", processedAt, errorMessage })
    .where(eq(schema.webhookEvents.id, eventId));
}

// ---------- AI Copilot: Conversation / ConversationMessage / AIToolExecution / AIRequestLog ----------

export async function upsertConversation(db: Database, conversation: Conversation): Promise<void> {
  const row = mappers.conversationToRow(conversation);
  await db
    .insert(schema.conversations)
    .values(row)
    .onConflictDoUpdate({ target: schema.conversations.id, set: row });
}

export async function getConversationById(db: Database, id: string): Promise<Conversation | undefined> {
  const [row] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id));
  return row ? mappers.rowToConversation(row) : undefined;
}

export async function listConversationsForProfile(
  db: Database,
  financialProfileId: string,
): Promise<Conversation[]> {
  const rows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.financialProfileId, financialProfileId))
    .orderBy(desc(schema.conversations.updatedAt));
  return rows.map(mappers.rowToConversation);
}

export async function insertConversationMessage(db: Database, message: ConversationMessage): Promise<void> {
  const row = mappers.conversationMessageToRow(message);
  await db
    .insert(schema.conversationMessages)
    .values(row)
    .onConflictDoUpdate({ target: schema.conversationMessages.id, set: row });
}

/** Full message history for a conversation, oldest first — the exact input the tool loop reconstructs each turn from. */
export async function listConversationMessages(
  db: Database,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const rows = await db
    .select()
    .from(schema.conversationMessages)
    .where(eq(schema.conversationMessages.conversationId, conversationId))
    .orderBy(schema.conversationMessages.createdAt);
  return rows.map(mappers.rowToConversationMessage);
}

export async function insertAIToolExecution(db: Database, execution: AIToolExecution): Promise<void> {
  const row = mappers.aiToolExecutionToRow(execution);
  await db
    .insert(schema.aiToolExecutions)
    .values(row)
    .onConflictDoUpdate({ target: schema.aiToolExecutions.id, set: row });
}

export async function listAIToolExecutionsForConversation(
  db: Database,
  conversationId: string,
): Promise<AIToolExecution[]> {
  const rows = await db
    .select()
    .from(schema.aiToolExecutions)
    .where(eq(schema.aiToolExecutions.conversationId, conversationId));
  return rows.map(mappers.rowToAIToolExecution);
}

export async function insertAIRequestLog(db: Database, log: AIRequestLog): Promise<void> {
  const row = mappers.aiRequestToRow(log);
  await db.insert(schema.aiRequests).values(row).onConflictDoUpdate({ target: schema.aiRequests.id, set: row });
}

export async function listAIRequestLogsForConversation(
  db: Database,
  conversationId: string,
): Promise<AIRequestLog[]> {
  const rows = await db
    .select()
    .from(schema.aiRequests)
    .where(eq(schema.aiRequests.conversationId, conversationId));
  return rows.map(mappers.rowToAIRequest);
}

// ---------- Connection deletion (Sprint 4.5 addendum, DEC-050) ----------
//
// Proper cascading-delete semantics for removing a single connection's
// data — never raw/ad-hoc SQL, and never touches shared/canonical fixture
// data (nothing here is scoped to a connection in the first place). Every
// function is a targeted DELETE keyed by id/foreign-key, run in FK-safe
// order by the caller (`app-services/src/sync.ts`'s `disconnectConnection`):
// reconciliation links -> installment plans -> bills -> transactions ->
// payment sources -> sync runs -> the connection row itself.

export async function listPaymentSourceIdsByConnectionId(
  db: Database,
  connectionId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: schema.paymentSources.id })
    .from(schema.paymentSources)
    .where(eq(schema.paymentSources.connectionId, connectionId));
  return rows.map((r) => r.id);
}

export async function listTransactionIdsByPaymentSourceIds(
  db: Database,
  paymentSourceIds: readonly string[],
): Promise<string[]> {
  if (paymentSourceIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.financialTransactions.id })
    .from(schema.financialTransactions)
    .where(inArray(schema.financialTransactions.paymentSourceId, [...paymentSourceIds]));
  return rows.map((r) => r.id);
}

/** Deletes any link referencing a to-be-deleted transaction on EITHER side — including a cross-connection link where the other side belongs to a connection being kept. */
export async function deleteReconciliationLinksReferencingTransactionIds(
  db: Database,
  transactionIds: readonly string[],
): Promise<number> {
  if (transactionIds.length === 0) return 0;
  const ids = [...transactionIds];
  const result = await db
    .delete(schema.reconciliationLinks)
    .where(
      or(
        inArray(schema.reconciliationLinks.primaryTransactionId, ids),
        inArray(schema.reconciliationLinks.linkedTransactionId, ids),
      ),
    )
    .returning({ id: schema.reconciliationLinks.id });
  return result.length;
}

/** Matches by EITHER originTransactionId or paymentSourceId — a provider-derived installment plan (e.g. from Pluggy's installmentMetadata) may set both. */
export async function deleteInstallmentPlansReferencing(
  db: Database,
  transactionIds: readonly string[],
  paymentSourceIds: readonly string[],
): Promise<number> {
  if (transactionIds.length === 0 && paymentSourceIds.length === 0) return 0;
  const conditions = [
    ...(transactionIds.length > 0
      ? [inArray(schema.installmentPlans.originTransactionId, [...transactionIds])]
      : []),
    ...(paymentSourceIds.length > 0
      ? [inArray(schema.installmentPlans.paymentSourceId, [...paymentSourceIds])]
      : []),
  ];
  const result = await db
    .delete(schema.installmentPlans)
    .where(or(...conditions))
    .returning({ id: schema.installmentPlans.id });
  return result.length;
}

export async function deleteBillsByPaymentSourceIds(
  db: Database,
  paymentSourceIds: readonly string[],
): Promise<number> {
  if (paymentSourceIds.length === 0) return 0;
  const result = await db
    .delete(schema.bills)
    .where(inArray(schema.bills.paymentSourceId, [...paymentSourceIds]))
    .returning({ id: schema.bills.id });
  return result.length;
}

export async function deleteTransactionsByIds(db: Database, transactionIds: readonly string[]): Promise<number> {
  if (transactionIds.length === 0) return 0;
  const result = await db
    .delete(schema.financialTransactions)
    .where(inArray(schema.financialTransactions.id, [...transactionIds]))
    .returning({ id: schema.financialTransactions.id });
  return result.length;
}

export async function deletePaymentSourcesByIds(
  db: Database,
  paymentSourceIds: readonly string[],
): Promise<number> {
  if (paymentSourceIds.length === 0) return 0;
  const result = await db
    .delete(schema.paymentSources)
    .where(inArray(schema.paymentSources.id, [...paymentSourceIds]))
    .returning({ id: schema.paymentSources.id });
  return result.length;
}

export async function deleteSyncRunsByConnectionId(db: Database, connectionId: string): Promise<number> {
  const result = await db
    .delete(schema.syncRuns)
    .where(eq(schema.syncRuns.connectionId, connectionId))
    .returning({ id: schema.syncRuns.id });
  return result.length;
}

export async function deleteProviderConnectionById(db: Database, connectionId: string): Promise<void> {
  await db.delete(schema.providerConnections).where(eq(schema.providerConnections.id, connectionId));
}

// ---------- Recommendation (Sprint 5) ----------

export async function upsertRecommendation(db: Database, recommendation: Recommendation): Promise<void> {
  const row = mappers.recommendationToRow(recommendation);
  await db
    .insert(schema.recommendations)
    .values(row)
    .onConflictDoUpdate({ target: schema.recommendations.id, set: row });
}

export async function getRecommendationById(db: Database, id: string): Promise<Recommendation | undefined> {
  const [row] = await db.select().from(schema.recommendations).where(eq(schema.recommendations.id, id));
  return row ? mappers.rowToRecommendation(row) : undefined;
}

/**
 * The idempotency lookup: a `financialProfileId` + `identityKey` pair maps
 * to AT MOST one recommendation (enforced by the unique constraint on the
 * table) — see `Recommendation.identityKey`'s doc comment and DEC-059.
 */
export async function findRecommendationByIdentityKey(
  db: Database,
  financialProfileId: string,
  identityKey: string,
): Promise<Recommendation | undefined> {
  const [row] = await db
    .select()
    .from(schema.recommendations)
    .where(
      and(
        eq(schema.recommendations.financialProfileId, financialProfileId),
        eq(schema.recommendations.identityKey, identityKey),
      ),
    );
  return row ? mappers.rowToRecommendation(row) : undefined;
}

export async function listRecommendationsForProfile(
  db: Database,
  financialProfileId: string,
): Promise<Recommendation[]> {
  const rows = await db
    .select()
    .from(schema.recommendations)
    .where(eq(schema.recommendations.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToRecommendation);
}

// ---------- Concierge (Sprint 6) ----------
//
// Unlike every other entity in this file, `ConciergeSession`/`OutingPlan`
// are APPLICATION-layer types (`packages/app-services/src/concierge/
// types.ts`), not `financial-engine` domain types — persistence cannot
// import them without an illegal app-services -> persistence -> app-services
// cycle. These functions therefore work with plain row shapes (JSON blobs
// + primitive fields); `concierge-service.ts` does its own mapping to/from
// its rich domain types. See docs/CONCIERGE.md, "Persistence."

export interface ConciergeSessionRow {
  readonly id: string;
  readonly financialProfileId: string;
  readonly intentJson: string;
  readonly envelopeRecommendedAmountCents: number;
  readonly envelopeCautionAmountCents: number;
  readonly envelopeAsOfDate: string;
  readonly plansJson: string;
  readonly createdAt: string;
}

export async function upsertConciergeSessionRow(db: Database, row: ConciergeSessionRow): Promise<void> {
  await db
    .insert(schema.conciergeSessions)
    .values(row)
    .onConflictDoUpdate({ target: schema.conciergeSessions.id, set: row });
}

export async function getConciergeSessionRowById(
  db: Database,
  id: string,
): Promise<ConciergeSessionRow | undefined> {
  const [row] = await db.select().from(schema.conciergeSessions).where(eq(schema.conciergeSessions.id, id));
  return row;
}

export interface SavedConciergePlanRow {
  readonly id: string;
  readonly sessionId: string;
  readonly financialProfileId: string;
  readonly planId: string;
  readonly planJson: string;
  readonly status: "SELECTED";
  readonly createdAt: string;
}

export async function upsertSavedConciergePlanRow(db: Database, row: SavedConciergePlanRow): Promise<void> {
  await db
    .insert(schema.savedConciergePlans)
    .values(row)
    .onConflictDoUpdate({ target: schema.savedConciergePlans.id, set: row });
}

export async function findSavedConciergePlanRowByPlanId(
  db: Database,
  financialProfileId: string,
  planId: string,
): Promise<SavedConciergePlanRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.savedConciergePlans)
    .where(
      and(
        eq(schema.savedConciergePlans.financialProfileId, financialProfileId),
        eq(schema.savedConciergePlans.planId, planId),
      ),
    );
  return row;
}

export async function listSavedConciergePlansForProfile(
  db: Database,
  financialProfileId: string,
): Promise<SavedConciergePlanRow[]> {
  return db
    .select()
    .from(schema.savedConciergePlans)
    .where(eq(schema.savedConciergePlans.financialProfileId, financialProfileId));
}

// ---------- Alerts / notifications (Sprint 7) ----------
//
// `Alert` is an APPLICATION-layer type (see `concierge`'s comment above for
// the identical reasoning) — plain JSON-blob rows here, mapping done by
// `app-services/src/alerts/alert-service.ts`.

export interface AlertRow {
  readonly id: string;
  readonly financialProfileId: string;
  readonly type: string;
  readonly status: string;
  readonly severity: string;
  readonly identityKey: string;
  readonly title: string;
  readonly reasonCode: string;
  readonly createdAt: string;
  readonly firstTriggeredAt: string;
  readonly lastTriggeredAt: string;
  readonly resolvedAt: string | null;
  readonly seenAt: string | null;
  readonly dismissedAt: string | null;
  readonly evidenceJson: string;
  readonly relatedEntityType: string | null;
  readonly relatedEntityId: string | null;
  readonly policyVersion: number;
  readonly transitionsJson: string;
}

export async function upsertAlertRow(db: Database, row: AlertRow): Promise<void> {
  await db.insert(schema.alerts).values(row).onConflictDoUpdate({ target: schema.alerts.id, set: row });
}

export async function getAlertRowById(db: Database, id: string): Promise<AlertRow | undefined> {
  const [row] = await db.select().from(schema.alerts).where(eq(schema.alerts.id, id));
  return row;
}

/** The single most recent row for a given identity — the entire "episode" lookup mechanism (see docs/ALERTS-NOTIFICATIONS.md, "Episode identity"). */
export async function findLatestAlertRowByIdentityKey(
  db: Database,
  financialProfileId: string,
  identityKey: string,
): Promise<AlertRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.alerts)
    .where(and(eq(schema.alerts.financialProfileId, financialProfileId), eq(schema.alerts.identityKey, identityKey)))
    .orderBy(desc(schema.alerts.createdAt))
    .limit(1);
  return row;
}

export async function listAlertRowsForProfile(db: Database, financialProfileId: string): Promise<AlertRow[]> {
  return db.select().from(schema.alerts).where(eq(schema.alerts.financialProfileId, financialProfileId));
}

export interface AlertEvaluationCheckpointRow {
  readonly id: string;
  readonly financialProfileId: string;
  readonly safeToSpendCents: number;
  readonly liquidityAwareSafeToSpendCents: number | null;
  readonly liquidityCoverage: LiquidityCoverage;
  readonly activeDropEpisodeBaselineCents: number | null;
  readonly evaluatedAt: string;
  readonly policyVersion: number;
}

export async function upsertAlertEvaluationCheckpointRow(
  db: Database,
  row: AlertEvaluationCheckpointRow,
): Promise<void> {
  await db
    .insert(schema.alertEvaluationCheckpoints)
    .values(row)
    .onConflictDoUpdate({ target: schema.alertEvaluationCheckpoints.financialProfileId, set: row });
}

export async function getAlertEvaluationCheckpointRow(
  db: Database,
  financialProfileId: string,
): Promise<AlertEvaluationCheckpointRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.alertEvaluationCheckpoints)
    .where(eq(schema.alertEvaluationCheckpoints.financialProfileId, financialProfileId));
  return row;
}

export interface NotificationPreferencesRow {
  readonly id: string;
  readonly financialProfileId: string;
  readonly inAppEnabled: boolean;
  readonly financialChangeEnabled: boolean;
  readonly plannedEventsEnabled: boolean;
  readonly recommendationsEnabled: boolean;
  readonly connectionHealthEnabled: boolean;
  readonly conciergeEnabled: boolean;
  readonly quietHoursStart: string | null;
  readonly quietHoursEnd: string | null;
  readonly privacyMode: "GENERIC" | "AMOUNT_ALLOWED";
  readonly updatedAt: string;
}

export async function upsertNotificationPreferencesRow(
  db: Database,
  row: NotificationPreferencesRow,
): Promise<void> {
  await db
    .insert(schema.notificationPreferences)
    .values(row)
    .onConflictDoUpdate({ target: schema.notificationPreferences.financialProfileId, set: row });
}

export async function getNotificationPreferencesRow(
  db: Database,
  financialProfileId: string,
): Promise<NotificationPreferencesRow | undefined> {
  const [row] = await db
    .select()
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.financialProfileId, financialProfileId));
  return row;
}

export interface NotificationDeliveryRow {
  readonly id: string;
  readonly alertId: string;
  readonly financialProfileId: string;
  readonly channel: string;
  readonly status: "PENDING" | "DELIVERED" | "FAILED" | "SUPPRESSED";
  readonly attemptedAt: string;
  readonly deliveredAt: string | null;
  readonly failureReasonCode: string | null;
}

export async function upsertNotificationDeliveryRow(db: Database, row: NotificationDeliveryRow): Promise<void> {
  await db
    .insert(schema.notificationDeliveries)
    .values(row)
    .onConflictDoUpdate({ target: schema.notificationDeliveries.id, set: row });
}

export async function listNotificationDeliveriesForAlert(
  db: Database,
  alertId: string,
): Promise<NotificationDeliveryRow[]> {
  return db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.alertId, alertId));
}

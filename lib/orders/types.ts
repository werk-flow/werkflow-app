import type { AcceptedScopeSection, ScopeTotals } from '@/lib/offers/accepted-scope';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// An order: an accepted offer converted into work once, with the Annahme's
// Auftragsumfang as its baseline
// (supabase/migrations/20270701160000_convert_an_accepted_offer_into_work_once.sql).

/** What a conversion creates: a new job, a new project, or the job or project the offer was written for. */
const ORDER_TARGETS = ['job', 'project', 'offer_work'] as const;
export type OrderTarget = (typeof ORDER_TARGETS)[number];

export const convertOfferSchema = z.object({
  offerId: uuidSchema,
  /** The version the dialog opened on: a change another session made meanwhile refuses the conversion. */
  expectedVersion: z.number().int().positive(),
  /** One key per pressed conversion: a retried press answers with the first work. */
  attemptKey: uuidSchema,
  target: z.enum(ORDER_TARGETS),
  /** The new work's title; the offer's own work keeps its title. */
  title: z.string().trim().max(200),
});
export type ConvertOfferInput = z.input<typeof convertOfferSchema>;

/** The work an offer became, with what its detail route needs. */
export type OfferWork = {
  kind: 'job' | 'project';
  id: string;
  number: string;
  title: string;
  /** For a job of a project, the project's number. */
  projectNumber: string | null;
};

/** An order as Admin and Büro read it on its work: the offer, the Annahme and the Auftragsumfang with its prices. */
export type WorkOrder = {
  id: string;
  offerId: string;
  offerNumber: string;
  revision: number;
  acceptedByName: string;
  acceptedOn: string;
  convertedAt: string;
  /** Null once the person's account is deleted. */
  convertedBy: string | null;
  scope: AcceptedScopeSection[];
  totals: ScopeTotals;
};

/** A line of the scope the field and the project lead read: text, quantity and unit. */
export type FieldScopeLine =
  | { kind: 'text'; name: string; description: string }
  | {
      kind: 'position';
      number: string;
      name: string;
      description: string;
      quantity: string;
      unitLabel: string;
    };

type FieldScopeSection = { number: string; title: string; lines: FieldScopeLine[] };

/**
 * One order's scope for the field and the project lead. The type holds no
 * price, cost, discount or total, and lib/orders/field-scope.test.ts keeps it so.
 */
export type FieldScopeOrder = {
  offerNumber: string;
  /** `project`: the order of the job's project, shown beside the job's own. */
  workKind: 'job' | 'project';
  sections: FieldScopeSection[];
};

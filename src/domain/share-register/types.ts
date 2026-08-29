export type ShareRange = Readonly<{
  from: number;
  to: number;
}>;

export type ShareholderDetails = Readonly<{
  legalName: string;
  emailAddress?: string;
  phoneNumber?: string;
  address: Readonly<{
    lines: readonly string[];
    postalCode: string;
    locality: string;
    countryCode: string;
  }>;
}>;

export type Shareholder = Readonly<{
  id: string;
  companyId: string;
  kind: "INDIVIDUAL" | "LEGAL_ENTITY";
  identifierCountryCode: "SE";
  identifierScheme: "PERSONNUMMER" | "ORGANISATIONSNUMMER";
  identifierValue: string;
  initialDetails: ShareholderDetails;
  effectiveFrom: string;
  registeredAt: string;
  registeredBy: string;
}>;

export type ShareClass = Readonly<{
  id: string;
  companyId: string;
  name: string;
  votesPerShare: string;
  effectiveFrom: string;
  registeredAt: string;
  registeredBy: string;
}>;

declare const exactDecimalBrand: unique symbol;
export type ExactDecimal = string & { readonly [exactDecimalBrand]: true };

export type ExactPrice = Readonly<{
  amount: ExactDecimal;
  currency: string;
}>;

export type ExactMoney = Readonly<{
  amount: ExactDecimal;
  currency: string;
}>;

export type Holding = Readonly<{
  shareholderId: string;
  shareClassId: string;
  range: ShareRange;
}>;

export type OpeningHolding = Readonly<{
  shareholderId: string;
  shareClassId: string;
  ranges: readonly ShareRange[];
}>;

export type TransferReason = "SALE" | "GIFT" | "INHERITANCE" | "DIVISION_OF_PROPERTY" | "OTHER";

export type CancellationReason = "REDEMPTION" | "CANCELLATION" | "OTHER";

export type ShareCapitalChangeReason =
  | "FORMATION"
  | "ISSUE"
  | "BONUS_ISSUE"
  | "REDUCTION"
  | "OTHER";

export type EventMetadata = Readonly<{
  id: string;
  companyId: string;
  sequence: number;
  schemaVersion: 1;
  effectiveDate: string;
  registeredAt: string;
  registeredBy: string;
  operationId: string;
}>;

export type OpeningStateImported = EventMetadata &
  Readonly<{
    type: "OPENING_STATE_IMPORTED";
    payload: Readonly<{
      holdings: readonly OpeningHolding[];
      sourceType: "SHARE_REGISTER" | "OCF" | "OTHER";
      importNote: string;
    }>;
  }>;

export type SharesIssued = EventMetadata &
  Readonly<{
    type: "SHARES_ISSUED";
    payload: Readonly<{
      shareholderId: string;
      shareClassId: string;
      ranges: readonly ShareRange[];
      subscriptionPrice?: ExactPrice;
    }>;
  }>;

export type SharesTransferred = EventMetadata &
  Readonly<{
    type: "SHARES_TRANSFERRED";
    payload: Readonly<{
      transferorId: string;
      transfereeId: string;
      shareClassId: string;
      ranges: readonly ShareRange[];
      reason: TransferReason;
      reasonNote?: string;
    }>;
  }>;

export type SharesCancelled = EventMetadata &
  Readonly<{
    type: "SHARES_CANCELLED";
    payload: Readonly<{
      shareholderId: string;
      shareClassId: string;
      ranges: readonly ShareRange[];
      reason: CancellationReason;
      reasonNote?: string;
    }>;
  }>;

export type ShareholderDetailsChanged = EventMetadata &
  Readonly<{
    type: "SHAREHOLDER_DETAILS_CHANGED";
    payload: Readonly<{
      shareholderId: string;
      before: ShareholderDetails;
      after: ShareholderDetails;
    }>;
  }>;

export type ShareCapitalChanged = EventMetadata &
  Readonly<{
    type: "SHARE_CAPITAL_CHANGED";
    payload: Readonly<{
      before?: ExactMoney;
      after: ExactMoney;
      reason: ShareCapitalChangeReason;
      note?: string;
    }>;
  }>;

export type SharesSplit = EventMetadata &
  Readonly<{
    type: "SHARES_SPLIT";
    payload: Readonly<{
      factor: number;
      note?: string;
    }>;
  }>;

export type SharesRenumbered = EventMetadata &
  Readonly<{
    type: "SHARES_RENUMBERED";
    payload: Readonly<{
      holdings: readonly OpeningHolding[];
      note: string;
    }>;
  }>;

export type SourceActivityRecorded = EventMetadata &
  Readonly<{
    type: "SOURCE_ACTIVITY_RECORDED";
    payload: Readonly<{
      sourceEventId: string;
      category: string;
      description: string;
      data?: Readonly<Record<string, unknown>>;
    }>;
  }>;

export type EventReversed = EventMetadata &
  Readonly<{
    type: "EVENT_REVERSED";
    payload: Readonly<{
      targetEventId: string;
      explanation: string;
    }>;
  }>;

export type ShareRegisterEvent =
  | OpeningStateImported
  | SharesIssued
  | SharesTransferred
  | SharesCancelled
  | ShareholderDetailsChanged
  | ShareCapitalChanged
  | SharesSplit
  | SharesRenumbered
  | SourceActivityRecorded
  | EventReversed;

export type ShareRegisterDomainEvent = ShareRegisterEvent;

export type RetiredRange = Readonly<{
  range: ShareRange;
  source: "CANCELLATION" | "REVERSAL";
  sourceEventId: string;
  targetEventId?: string;
  operationId: string;
  reusable: boolean;
}>;

export type ShareRegisterState = Readonly<{
  companyId: string;
  shareCapital?: ExactMoney;
  holdings: readonly Holding[];
  retiredRanges: readonly RetiredRange[];
  shareholderDetails: readonly Readonly<{
    shareholderId: string;
    details: ShareholderDetails;
  }>[];
  appliedEventIds: readonly string[];
  reversedEventIds: readonly string[];
  activeOpeningEventId?: string;
}>;

export type ShareRegisterSnapshot = Readonly<{
  companyId: string;
  shareCapital?: ExactMoney;
  effectiveOn?: string;
  knownAt?: string;
  holdings: readonly Holding[];
  shareholderDetails: readonly Readonly<{
    shareholderId: string;
    details: ShareholderDetails;
  }>[];
  totalsByClass: readonly Readonly<{
    shareClassId: string;
    total: number;
  }>[];
  totalsByShareholder: readonly Readonly<{
    shareholderId: string;
    total: number;
  }>[];
  appliedEventIds: readonly string[];
  lastAppliedSequence?: number;
}>;

export type ShareRegisterInput = Readonly<{
  companyId: string;
  shareholders: readonly Shareholder[];
  shareClasses: readonly ShareClass[];
  events: readonly unknown[];
  effectiveOn?: string;
  knownAt?: string;
}>;

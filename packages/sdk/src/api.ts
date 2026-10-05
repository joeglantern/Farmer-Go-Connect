import type {
  AdminUserQuery,
  AgentCreateFarmerInput,
  AssignDriverInput,
  AuditQuery,
  BuildRoutesInput,
  CancelOrderInput,
  CompleteStopInput,
  CrateQuery,
  CreateCratesInput,
  CreateDemandInput,
  CreateListingInput,
  CreateOrderInput,
  DemandBoardQuery,
  DemandQuery,
  FailStopInput,
  FarmInput,
  FarmUpdateInput,
  ForecastQuery,
  InputOrderInput,
  InputOrderTransitionInput,
  InputProductInput,
  InputProductQuery,
  InputProductUpdate,
  InspectionInput,
  KycReviewInput,
  ListingQuery,
  LocationPing,
  MarkReadInput,
  MatchOverrideInput,
  MatchQuery,
  MessageInput,
  NotificationPrefsInput,
  NotificationQuery,
  OnboardBuyerInput,
  OnboardFarmerInput,
  OnboardSupplierInput,
  OrderQuery,
  Pagination,
  PayOrderInput,
  PresignGetInput,
  PresignInput,
  PriceQuery,
  ProduceInput,
  ProduceQuery,
  ProduceUpdateInput,
  QaTaskQuery,
  RaiseDisputeInput,
  RegisterDeviceInput,
  ReportQuery,
  ResolveDisputeInput,
  ReviewInput,
  RouteQuery,
  ScanCrateInput,
  SetRoleInput,
  SettingInput,
  TransitionInput,
  UpdateDemandInput,
  UpdateFarmerProfileInput,
  UpdateListingInput,
  UpdateMeInput,
  UpdateOrgProfileInput,
  VerifyOrgInput,
} from '@farmgo/contracts';
import type { z } from 'zod';
import { createHttp, type HttpClient, type HttpOptions, type RequestOptions } from './http.js';
import { seg } from './query.js';
import type * as T from './types.js';

// ─── Input typing ─────────────────────────────────────────────

/** Accept a Date or an ISO string wherever the API coerces a date. */
type Loosen<V> = V extends Date
  ? Date | string
  : V extends readonly (infer U)[]
    ? Loosen<U>[]
    : V extends object
      ? { [K in keyof V]: Loosen<V[K]> }
      : V;

/**
 * Request type for a contracts schema: optionality from the schema's input side, value types
 * from its output side where the input is `unknown` (Zod's `coerce` schemas), so `limit` is a
 * number and `availableFrom` is a `Date | string` instead of `unknown`.
 */
export type Input<S extends z.ZodTypeAny> = {
  [K in keyof z.input<S>]: unknown extends z.input<S>[K]
    ? K extends keyof z.output<S>
      ? Loosen<z.output<S>[K]>
      : unknown
    : Loosen<z.input<S>[K]>;
};

export type ApiOptions = HttpOptions;
export type Opts = Pick<RequestOptions, 'idempotencyKey' | 'signal' | 'timeoutMs' | 'headers'>;

// Local schemas the API declares inline (not exported from contracts).
export interface BanUserBody {
  reason: string;
  banned?: boolean;
}
export interface ManualPaymentBody {
  orderId?: string;
  invoiceId?: string;
  amount: number;
  method: 'BANK_TRANSFER' | 'CASH';
  reference: string;
}
export type DisputesQuery = Input<typeof Pagination> & { open?: boolean };
export type AdminPayoutsQuery = Input<typeof Pagination> & { status?: 'PENDING' | 'SUCCESS' | 'FAILED' };
export interface UssdBody {
  sessionId: string;
  phoneNumber: string;
  text?: string;
  serviceCode?: string;
}
export interface SmsDeliveryReportBody {
  id: string;
  status: string;
  phoneNumber?: string;
  failureReason?: string;
  [k: string]: unknown;
}

/** Better Auth request bodies used by the app. */
export interface SignInEmailBody {
  email: string;
  password: string;
  rememberMe?: boolean;
}
export interface SignUpEmailBody {
  email: string;
  password: string;
  name: string;
}
export interface SendOtpBody {
  phoneNumber: string;
}
export interface VerifyOtpBody {
  phoneNumber: string;
  code: string;
  /** Keep the user signed out after verifying (default false). */
  disableSession?: boolean;
}

export type FarmGoApi = ReturnType<typeof createApi>;

/**
 * Typed client for every path in the API's OpenAPI document. Methods return the JSON body; use
 * `api.http.request()` for the status and headers, or for a path this SDK does not know yet.
 */
export function createApi(options: ApiOptions) {
  const http: HttpClient = createHttp(options);
  const { get, post, patch, put } = http;
  const del = http.delete;

  return {
    /** Low-level client (shares auth, org, language and idempotency settings). */
    http,

    health: {
      live: () => get<T.HealthLive>('/health/live', undefined, { anonymous: true }),
      ready: () => get<T.HealthReady>('/health/ready', undefined, { anonymous: true }),
    },

    /**
     * Better Auth endpoints (`/api/auth/*`). The app normally uses the Better Auth Expo client;
     * these thin wrappers exist for tests, tooling and simple flows.
     */
    auth: {
      signInEmail: (body: SignInEmailBody, o?: Opts) =>
        post<T.AuthSession>('/api/auth/sign-in/email', body, { ...o, anonymous: true }),
      signUpEmail: (body: SignUpEmailBody, o?: Opts) =>
        post<T.AuthSession>('/api/auth/sign-up/email', body, { ...o, anonymous: true }),
      /** Farmers sign in by phone: request a code (printed in the API log in development). */
      sendOtp: (body: SendOtpBody, o?: Opts) =>
        post<{ status?: boolean; message?: string } | null>('/api/auth/phone-number/send-otp', body, {
          ...o,
          anonymous: true,
        }),
      verifyOtp: (body: VerifyOtpBody, o?: Opts) =>
        post<T.AuthSession>('/api/auth/phone-number/verify', body, { ...o, anonymous: true }),
      session: (o?: Opts) => get<T.SessionInfo | null>('/api/auth/get-session', undefined, o),
      signOut: (o?: Opts) => post<{ success?: boolean } | null>('/api/auth/sign-out', {}, o),
    },

    me: {
      get: (o?: Opts) => get<T.Me>('/v1/me', undefined, o),
      update: (body: Input<typeof UpdateMeInput>, o?: Opts) => patch<T.UpdateMeResult>('/v1/me', body, o),
      updateFarmerProfile: (body: Input<typeof UpdateFarmerProfileInput>, o?: Opts) =>
        patch<T.FarmerProfile>('/v1/me/farmer-profile', body, o),
    },

    onboarding: {
      farmer: (body: Input<typeof OnboardFarmerInput>, o?: Opts) =>
        post<T.OnboardFarmerResult>('/v1/onboarding/farmer', body, o),
      buyer: (body: Input<typeof OnboardBuyerInput>, o?: Opts) =>
        post<T.OnboardOrgResult>('/v1/onboarding/buyer', body, o),
      supplier: (body: Input<typeof OnboardSupplierInput>, o?: Opts) =>
        post<T.OnboardOrgResult>('/v1/onboarding/supplier', body, o),
    },

    orgs: {
      current: (o?: Opts) => get<T.CurrentOrg>('/v1/orgs/current', undefined, o),
      updateCurrent: (body: Input<typeof UpdateOrgProfileInput>, o?: Opts) =>
        patch<T.OrgProfile>('/v1/orgs/current', body, o),
    },

    /** Field agents onboarding farmers who may not own a smartphone. */
    agent: {
      createFarmer: (body: Input<typeof AgentCreateFarmerInput>, o?: Opts) =>
        post<T.AgentCreateFarmerResult>('/v1/agent/farmers', body, o),
      farmers: (query?: Input<typeof Pagination>, o?: Opts) =>
        get<T.Page<T.AgentFarmer>>('/v1/agent/farmers', query, o),
      /** `farmerProfileId` is the farmer *profile* id (`FarmerProfile.id`), not the user id. */
      addFarm: (farmerProfileId: string, body: Input<typeof FarmInput>, o?: Opts) =>
        post<T.Farm>(`/v1/agent/farmers/${seg(farmerProfileId)}/farms`, body, o),
    },

    uploads: {
      /** Then PUT the file to `url` with `headers`, and send `key` in the related request. See `uploadFile`. */
      presign: (body: Input<typeof PresignInput>, o?: Opts) =>
        post<T.PresignResult>('/v1/uploads/presign', body, o),
      /** Short-lived URL to view a private file. */
      url: (body: Input<typeof PresignGetInput>, o?: Opts) =>
        post<T.FileUrlResult>('/v1/uploads/url', body, o),
    },

    farms: {
      list: (o?: Opts) => get<T.Farm[]>('/v1/farms', undefined, o),
      create: (body: Input<typeof FarmInput>, o?: Opts) => post<T.Farm>('/v1/farms', body, o),
      get: (id: string, o?: Opts) => get<T.FarmDetail>(`/v1/farms/${seg(id)}`, undefined, o),
      update: (id: string, body: Input<typeof FarmUpdateInput>, o?: Opts) =>
        patch<T.Farm>(`/v1/farms/${seg(id)}`, body, o),
    },

    produce: {
      list: (query?: Input<typeof ProduceQuery>, o?: Opts) => get<T.Produce[]>('/v1/produce', query, o),
      get: (id: string, o?: Opts) => get<T.Produce>(`/v1/produce/${seg(id)}`, undefined, o),
      /** Admin. */
      create: (body: Input<typeof ProduceInput>, o?: Opts) => post<T.Produce>('/v1/produce', body, o),
      /** Admin. */
      update: (id: string, body: Input<typeof ProduceUpdateInput>, o?: Opts) =>
        patch<T.Produce>(`/v1/produce/${seg(id)}`, body, o),
    },

    supply: {
      list: (query?: Input<typeof ListingQuery>, o?: Opts) =>
        get<T.Page<T.ListingPublic>>('/v1/supply', query, o),
      create: (body: Input<typeof CreateListingInput>, o?: Opts) => post<T.ListingOwn>('/v1/supply', body, o),
      get: (id: string, o?: Opts) => get<T.ListingPublic>(`/v1/supply/${seg(id)}`, undefined, o),
      update: (id: string, body: Input<typeof UpdateListingInput>, o?: Opts) =>
        patch<T.ListingOwn>(`/v1/supply/${seg(id)}`, body, o),
      harvestReady: (id: string, o?: Opts) =>
        post<T.HarvestReadyResult>(`/v1/supply/${seg(id)}/harvest-ready`, undefined, o),
    },

    demand: {
      list: (query?: Input<typeof DemandQuery>, o?: Opts) =>
        get<T.Page<T.DemandListItem>>('/v1/demand', query, o),
      create: (body: Input<typeof CreateDemandInput>, o?: Opts) =>
        post<T.DemandCreated>('/v1/demand', body, o),
      board: (query?: Input<typeof DemandBoardQuery>, o?: Opts) =>
        get<T.DemandBoardRow[]>('/v1/demand/board', query, o),
      get: (id: string, o?: Opts) => get<T.DemandDetail>(`/v1/demand/${seg(id)}`, undefined, o),
      update: (id: string, body: Input<typeof UpdateDemandInput>, o?: Opts) =>
        patch<T.DemandCreated>(`/v1/demand/${seg(id)}`, body, o),
      cancel: (id: string, o?: Opts) =>
        patch<T.DemandCreated>(`/v1/demand/${seg(id)}`, { status: 'CANCELLED' }, o),
    },

    matches: {
      list: (query?: Input<typeof MatchQuery>, o?: Opts) =>
        get<T.Page<T.MatchListItem>>('/v1/matches', query, o),
      accept: (id: string, o?: Opts) =>
        post<T.AcceptMatchResult>(`/v1/matches/${seg(id)}/accept`, undefined, o),
      reject: (id: string, o?: Opts) => post<T.Ok>(`/v1/matches/${seg(id)}/reject`, undefined, o),
    },

    orders: {
      list: (query?: Input<typeof OrderQuery>, o?: Opts) =>
        get<T.Page<T.OrderListItem>>('/v1/orders', query, o),
      create: (body: Input<typeof CreateOrderInput>, o?: Opts) => post<T.Order>('/v1/orders', body, o),
      get: (id: string, o?: Opts) => get<T.OrderDetail>(`/v1/orders/${seg(id)}`, undefined, o),
      confirm: (id: string, o?: Opts) => post<T.Order>(`/v1/orders/${seg(id)}/confirm`, undefined, o),
      ready: (id: string, o?: Opts) => post<T.Order>(`/v1/orders/${seg(id)}/ready`, undefined, o),
      cancel: (id: string, body: Input<typeof CancelOrderInput>, o?: Opts) =>
        post<T.Order>(`/v1/orders/${seg(id)}/cancel`, body, o),
      transition: (id: string, body: Input<typeof TransitionInput>, o?: Opts) =>
        post<T.Order>(`/v1/orders/${seg(id)}/transition`, body, o),
      /** M-Pesa STK push. Poll `payments.get(paymentId)` or listen on the order channel. */
      pay: (id: string, body: Input<typeof PayOrderInput> = {}, o?: Opts) =>
        post<T.PayResult>(`/v1/orders/${seg(id)}/pay`, body, o),
      /** Buyer confirms the delivery was fine, releasing the farmer's payout. */
      confirmReceipt: (id: string, o?: Opts) =>
        post<T.Order>(`/v1/orders/${seg(id)}/confirm-receipt`, undefined, o),
      dispute: (id: string, body: Input<typeof RaiseDisputeInput>, o?: Opts) =>
        post<T.Dispute>(`/v1/orders/${seg(id)}/dispute`, body, o),
      review: (id: string, body: Input<typeof ReviewInput>, o?: Opts) =>
        post<T.Review>(`/v1/orders/${seg(id)}/review`, body, o),
      messages: (id: string, o?: Opts) =>
        get<T.OrderMessageItem[]>(`/v1/orders/${seg(id)}/messages`, undefined, o),
      sendMessage: (id: string, body: Input<typeof MessageInput>, o?: Opts) =>
        post<T.OrderMessageItem>(`/v1/orders/${seg(id)}/messages`, body, o),
      tracking: (id: string, o?: Opts) =>
        get<T.TrackingResult>(`/v1/orders/${seg(id)}/tracking`, undefined, o),
    },

    qa: {
      tasks: (query?: Input<typeof QaTaskQuery>, o?: Opts) => get<T.QaTask[]>('/v1/qa/tasks', query, o),
      inspect: (body: Input<typeof InspectionInput>, o?: Opts) =>
        post<T.InspectionResult>('/v1/qa/inspections', body, o),
      inspection: (id: string, o?: Opts) =>
        get<T.InspectionDetail>(`/v1/qa/inspections/${seg(id)}`, undefined, o),
    },

    routes: {
      /** Admin. */
      list: (query?: Input<typeof RouteQuery>, o?: Opts) =>
        get<T.Page<T.RouteListItem>>('/v1/routes', query, o),
      build: (body: Input<typeof BuildRoutesInput>, o?: Opts) =>
        post<T.BuildRoutesResult>('/v1/routes/build', body, o),
      assign: (id: string, body: Input<typeof AssignDriverInput>, o?: Opts) =>
        post<T.Route>(`/v1/routes/${seg(id)}/assign`, body, o),
      /** Driver: today's routes plus anything still open. */
      today: (o?: Opts) => get<T.RouteWithStops[]>('/v1/routes/today', undefined, o),
      get: (id: string, o?: Opts) => get<T.RouteDetail>(`/v1/routes/${seg(id)}`, undefined, o),
      start: (id: string, o?: Opts) => post<T.Route>(`/v1/routes/${seg(id)}/start`, undefined, o),
      /** REST fallback for the WebSocket `location` message. */
      location: (id: string, body: Omit<Input<typeof LocationPing>, 'routeId'>, o?: Opts) =>
        post<T.LocationResult>(`/v1/routes/${seg(id)}/location`, body, o),
    },

    stops: {
      arrive: (id: string, o?: Opts) => post<T.Stop>(`/v1/stops/${seg(id)}/arrive`, undefined, o),
      complete: (id: string, body: Input<typeof CompleteStopInput> = {}, o?: Opts) =>
        post<T.Stop>(`/v1/stops/${seg(id)}/complete`, body, o),
      fail: (id: string, body: Input<typeof FailStopInput>, o?: Opts) =>
        post<T.Stop>(`/v1/stops/${seg(id)}/fail`, body, o),
    },

    crates: {
      /** Admin. */
      create: (body: Input<typeof CreateCratesInput>, o?: Opts) =>
        post<T.CratesCreated>('/v1/crates', body, o),
      list: (query?: Input<typeof CrateQuery>, o?: Opts) => get<T.CratesPage>('/v1/crates', query, o),
      get: (qrCode: string, o?: Opts) => get<T.CrateDetail>(`/v1/crates/${seg(qrCode)}`, undefined, o),
      scan: (body: Input<typeof ScanCrateInput>, o?: Opts) => post<T.Crate>('/v1/crates/scan', body, o),
    },

    payments: {
      list: (query?: Input<typeof Pagination>, o?: Opts) =>
        get<T.Page<T.PaymentListItem>>('/v1/payments', query, o),
      /** Poll after an STK push until `status` leaves PENDING. */
      get: (id: string, o?: Opts) => get<T.PaymentDetail>(`/v1/payments/${seg(id)}`, undefined, o),
    },

    invoices: {
      list: (query?: Input<typeof Pagination>, o?: Opts) =>
        get<T.Page<T.InvoiceListItem>>('/v1/invoices', query, o),
      get: (id: string, o?: Opts) => get<T.InvoiceDetail>(`/v1/invoices/${seg(id)}`, undefined, o),
      pay: (id: string, body: Input<typeof PayOrderInput> = {}, o?: Opts) =>
        post<T.PayResult>(`/v1/invoices/${seg(id)}/pay`, body, o),
    },

    payouts: {
      /** Farmer. */
      list: (query?: Input<typeof Pagination>, o?: Opts) => get<T.PayoutsPage>('/v1/payouts', query, o),
    },

    prices: {
      /** Weekly price index rows. */
      index: (query?: Input<typeof PriceQuery>, o?: Opts) => get<T.PricePointItem[]>('/v1/prices', query, o),
      latest: (query?: Pick<Input<typeof PriceQuery>, 'county'>, o?: Opts) =>
        get<T.LatestPrice[]>('/v1/prices/latest', query, o),
    },

    forecasts: {
      list: (query?: Input<typeof ForecastQuery>, o?: Opts) =>
        get<T.ForecastItem[]>('/v1/forecasts', query, o),
    },

    /** Green inputs marketplace (compost, seedlings, packaging...). */
    inputs: {
      list: (query?: Input<typeof InputProductQuery>, o?: Opts) =>
        get<T.Page<T.InputProductItem>>('/v1/inputs', query, o),
      create: (body: Input<typeof InputProductInput>, o?: Opts) =>
        post<T.InputProduct>('/v1/inputs', body, o),
      get: (id: string, o?: Opts) => get<T.InputProductItem>(`/v1/inputs/${seg(id)}`, undefined, o),
      update: (id: string, body: Input<typeof InputProductUpdate>, o?: Opts) =>
        patch<T.InputProduct>(`/v1/inputs/${seg(id)}`, body, o),
      order: (id: string, body: Input<typeof InputOrderInput>, o?: Opts) =>
        post<T.InputOrderCreated>(`/v1/inputs/${seg(id)}/order`, body, o),
    },

    inputOrders: {
      list: (query?: Input<typeof Pagination>, o?: Opts) =>
        get<T.Page<T.InputOrderListItem>>('/v1/input-orders', query, o),
      transition: (id: string, body: Input<typeof InputOrderTransitionInput>, o?: Opts) =>
        post<T.InputOrder>(`/v1/input-orders/${seg(id)}/transition`, body, o),
    },

    notifications: {
      list: (query?: Input<typeof NotificationQuery>, o?: Opts) =>
        get<T.NotificationsPage>('/v1/notifications', query, o),
      markRead: (body: Input<typeof MarkReadInput>, o?: Opts) =>
        post<T.MarkReadResult>('/v1/notifications/read', body, o),
      preferences: (o?: Opts) => get<T.NotificationPreference>('/v1/notifications/preferences', undefined, o),
      updatePreferences: (body: Input<typeof NotificationPrefsInput>, o?: Opts) =>
        patch<T.NotificationPreference>('/v1/notifications/preferences', body, o),
    },

    devices: {
      register: (body: Input<typeof RegisterDeviceInput>, o?: Opts) =>
        post<T.DeviceToken>('/v1/devices', body, o),
      unregister: (token: string, o?: Opts) => del<T.Ok>(`/v1/devices/${seg(token)}`, o),
    },

    admin: {
      summary: (o?: Opts) => get<T.OpsSummary>('/v1/admin/summary', undefined, o),
      impact: (query?: Input<typeof ReportQuery>, o?: Opts) =>
        get<T.ImpactReport>('/v1/admin/reports/impact', query, o),
      users: {
        list: (query?: Input<typeof AdminUserQuery>, o?: Opts) =>
          get<T.Page<T.AdminUserListItem>>('/v1/admin/users', query, o),
        get: (id: string, o?: Opts) => get<T.AdminUserDetail>(`/v1/admin/users/${seg(id)}`, undefined, o),
        setRole: (id: string, body: Input<typeof SetRoleInput>, o?: Opts) =>
          post<T.SetRoleResult>(`/v1/admin/users/${seg(id)}/role`, body, o),
        ban: (id: string, body: BanUserBody, o?: Opts) =>
          post<T.BanResult>(`/v1/admin/users/${seg(id)}/ban`, body, o),
      },
      kyc: {
        pending: (query?: Input<typeof Pagination>, o?: Opts) =>
          get<T.Page<T.KycPending>>('/v1/admin/kyc', query, o),
        /** `farmerProfileId` is `FarmerProfile.id`. */
        review: (farmerProfileId: string, body: Input<typeof KycReviewInput>, o?: Opts) =>
          post<T.FarmerProfile>(`/v1/admin/farmers/${seg(farmerProfileId)}/kyc`, body, o),
      },
      orgs: {
        list: (query?: Input<typeof Pagination>, o?: Opts) =>
          get<T.Page<T.AdminOrgItem>>('/v1/admin/orgs', query, o),
        verify: (id: string, body: Input<typeof VerifyOrgInput>, o?: Opts) =>
          post<T.OrgProfile>(`/v1/admin/orgs/${seg(id)}/verify`, body, o),
      },
      matches: {
        create: (body: Input<typeof MatchOverrideInput>, o?: Opts) =>
          post<T.Match>('/v1/admin/matches', body, o),
      },
      disputes: {
        list: (query?: DisputesQuery, o?: Opts) =>
          get<T.Page<T.DisputeListItem>>('/v1/admin/disputes', query, o),
        review: (id: string, o?: Opts) =>
          post<T.Dispute>(`/v1/admin/disputes/${seg(id)}/review`, undefined, o),
        resolve: (id: string, body: Input<typeof ResolveDisputeInput>, o?: Opts) =>
          post<T.ResolveDisputeResult>(`/v1/admin/disputes/${seg(id)}/resolve`, body, o),
      },
      payouts: {
        list: (query?: AdminPayoutsQuery, o?: Opts) =>
          get<T.Page<T.AdminPayoutItem>>('/v1/admin/payouts', query, o),
        retry: (orderId: string, o?: Opts) =>
          post<T.Payout | null>(`/v1/admin/payouts/${seg(orderId)}/retry`, undefined, o),
      },
      payments: {
        manual: (body: ManualPaymentBody, o?: Opts) => post<T.Payment>('/v1/admin/payments/manual', body, o),
      },
      settings: {
        get: (o?: Opts) => get<T.PlatformSettings>('/v1/admin/settings', undefined, o),
        set: (key: string, body: Input<typeof SettingInput>, o?: Opts) =>
          put<T.PlatformSettings>(`/v1/admin/settings/${seg(key)}`, body, o),
      },
      audit: (query?: Input<typeof AuditQuery>, o?: Opts) =>
        get<T.Page<T.AuditLog>>('/v1/admin/audit', query, o),
      jobs: {
        run: (name: string, o?: Opts) =>
          post<T.JobRunResult>(`/v1/admin/jobs/${seg(name)}/run`, undefined, o),
      },
    },

    /**
     * Provider callbacks (Daraja, Africa's Talking). The app never calls these; they are here so
     * QA tooling can drive USSD sessions and simulate payment results against a dev API.
     */
    webhooks: {
      /** Returns the USSD screen text (`CON ...` or `END ...`). */
      ussd: (body: UssdBody, o?: Opts) =>
        http.call<string>('POST', '/webhooks/ussd', { ...o, body, anonymous: true }),
      mpesaStk: (body: unknown, token: string, o?: Opts) =>
        http.call<unknown>('POST', '/webhooks/mpesa/stk', { ...o, body, query: { token }, anonymous: true }),
      mpesaB2cResult: (body: unknown, token: string, o?: Opts) =>
        http.call<unknown>('POST', '/webhooks/mpesa/b2c/result', {
          ...o,
          body,
          query: { token },
          anonymous: true,
        }),
      mpesaB2cTimeout: (body: unknown, token: string, o?: Opts) =>
        http.call<unknown>('POST', '/webhooks/mpesa/b2c/timeout', {
          ...o,
          body,
          query: { token },
          anonymous: true,
        }),
      smsDeliveryReport: (body: SmsDeliveryReportBody, o?: Opts) =>
        http.call<unknown>('POST', '/webhooks/sms/delivery-report', { ...o, body, anonymous: true }),
    },
  };
}

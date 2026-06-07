export type SubscriptionPlan = 'free' | 'pro';

export type SubscriptionStatus = 'inactive' | 'active' | 'canceled';

export interface SessionUser {
  id: string;
  login: string;
  name?: string;
  avatarUrl?: string;
  email?: string;
}

export interface SubscriptionState {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  provider: 'mock' | 'supabase' | 'manual' | 'paymongo';
  updatedAt: string;
  planCode?: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  amountPhp?: number;
  interval?: 'month' | 'year';
}

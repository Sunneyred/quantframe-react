import { TauriTypes } from "$types";
import { useMutation } from "@tanstack/react-query";
import { TauriClient } from "..";
export class WfInventoryModule {
  constructor(private readonly client: TauriClient) {}
  async getRivensPagination(query: TauriTypes.WFItemControllerGetListParams): Promise<TauriTypes.WFInvRivenControllerGetListData> {
    return await this.client.sendInvoke<TauriTypes.WFInvRivenControllerGetListData>("wf_inventory_get_rivens", {
      query: this.client.convertToTauriQuery(query),
    });
  }
  async getSyndicatesPagination(query: TauriTypes.WFItemControllerGetListParams): Promise<TauriTypes.WFInvSyndicateControllerGetListData> {
    return await this.client.sendInvoke<TauriTypes.WFInvSyndicateControllerGetListData>("wf_inventory_get_syndicates", {
      query: this.client.convertToTauriQuery(query),
    });
  }
  update() {
    return useMutation({
      mutationFn: () => this.client.sendInvoke<void>("wf_inventory_update"),
    });
  }
  // Void Trader
  async sellFinder(min_price?: number): Promise<SellFinderResult> {
    return await this.client.sendInvoke<SellFinderResult>("vt_sell_finder", { min_price });
  }
  async platGoal(): Promise<PlatGoal> {
    return await this.client.sendInvoke<PlatGoal>("vt_plat_goal");
  }
  async refresh(): Promise<void> {
    return await this.client.sendInvoke<void>("wf_inventory_update");
  }
}

export interface SellCandidate {
  name: string;
  wfm_url: string;
  unique_name: string;
  icon: string;
  category: string;
  quantity: number;
  unit_price: number;
  total: number;
  volume: number;
  week_price_shift: number;
  basis: "exact" | "max_rank" | "arcane_estimate";
  sub_type?: TauriTypes.SubType;
  in_stock: boolean;
}
export interface SellFinderResult {
  connected: boolean;
  platinum: number;
  trades_remaining: number;
  mastery_rank: number;
  owned_tradable: number;
  unpriced: number;
  total_value: number;
  items: SellCandidate[];
}
export interface PlatGoal {
  platinum: number;
  floor: number;
  goal: number;
  progress: number;
  daily_target: number;
  avg_daily_profit: number;
  profit_today: number;
  balance_is_live: boolean;
}

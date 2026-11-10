import { TauriClient } from "..";
import { QuantframeApiTypes, TauriTypes } from "../../types";

export class RivenModule {
  constructor(private readonly client: TauriClient) {}

  // Void Trader: riven prices come from the local riven market (public warframe.market auctions).
  async getAll(query: QuantframeApiTypes.RivenPriceControllerGetListParams): Promise<QuantframeApiTypes.RivenPriceControllerGetListData> {
    return this.client.sendInvoke<QuantframeApiTypes.RivenPriceControllerGetListData>(`vt_riven_prices_lookup`, { query });
  }
  async marketScan(): Promise<RivenMarketStatus> {
    return this.client.sendInvoke<RivenMarketStatus>("vt_riven_market_scan");
  }
  async marketStop(): Promise<RivenMarketStatus> {
    return this.client.sendInvoke<RivenMarketStatus>("vt_riven_market_stop");
  }
  async marketStatus(): Promise<RivenMarketStatus> {
    return this.client.sendInvoke<RivenMarketStatus>("vt_riven_market_status");
  }
  async priceHistory(wfm_url: string): Promise<QuantframeApiTypes.RivenPriceDto[]> {
    return this.client.sendInvoke<QuantframeApiTypes.RivenPriceDto[]>("vt_riven_price_history", { wfmUrl: wfm_url });
  }
  async pricerAvailable(): Promise<boolean> {
    return this.client.sendInvoke<boolean>("riven_pricer_available");
  }
  async predictPrice(input: TauriTypes.RivenPriceInput): Promise<TauriTypes.RivenPriceEstimate | null> {
    return this.client.sendInvoke<TauriTypes.RivenPriceEstimate | null>("riven_price_predict", { input });
  }
  async reloadPricer(): Promise<boolean> {
    return this.client.sendInvoke<boolean>("riven_pricer_reload");
  }
  async getKnownRivenWeapons(): Promise<string[]> {
    return this.client.sendInvoke<string[]>("get_known_riven_weapons");
  }
  exportJson = async (query: QuantframeApiTypes.RivenPriceControllerGetListParams): Promise<string> => {
    return await this.client.sendInvoke<string>("vt_riven_prices_export", { query });
  };
}

export interface RivenMarketStatus {
  running: boolean;
  done: number;
  total: number;
  current: string;
  started_at?: string | null;
  last_completed?: string | null;
  last_error?: string | null;
}

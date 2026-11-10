import { TauriTypes } from "$types";
import api from "@api/index";
import { SelectRivenWeapon } from "@components/Forms/SelectRivenWeapon";
import { modals } from "@mantine/modals";
import { default as dayjs, default as utc } from "dayjs";
import { useEffect, useState } from "react";
import { TradeEntryList } from "../../helpers/TradeEntryList";
import { FindInterestingRivensModal } from "./FindInterestingRivensModal";
dayjs.extend(utc);
interface RivenPanelProps {
  isActive?: boolean;
}

export const RivenPanel = ({ isActive }: RivenPanelProps = {}) => {
  // States
  const [tradeEntry, setTradeEntry] = useState<TauriTypes.CreateTradeEntry & { wfm_url: string }>({
    raw: "",
    wfm_url: "",
    price: 1,
    group: "riven",
  });
  useEffect(() => {
    console.log("tradeEntry.raw", tradeEntry);
  }, [tradeEntry.raw]);
  // Mutations
  return (
    <TradeEntryList
      createComponent={
        <SelectRivenWeapon
          value={tradeEntry?.wfm_url || ""}
          onChange={(item) => setTradeEntry({ ...tradeEntry, raw: item.wfmRivenId, wfm_url: item.wfmRivenUrl })}
        />
      }
      isActive={isActive}
      group="riven"
      onFindInteresting={async ({ createMultipleMutation }) => {
        // Void Trader: use the latest local riven market scan.
        let items: any = await api.riven.getAll({ page: 1, limit: -1 });
        const latest = (items.results || []).reduce((acc: string, r: any) => (r.datetime > acc ? r.datetime : acc), "");
        let date = latest || dayjs().utc().toISOString();
        modals.open({
          size: "100%",
          title: "",
          withCloseButton: false,
          children: (
            <FindInterestingRivensModal
              date={new Date(date)}
              rivens={items.results || []}
              onSubmit={(data) => {
                if (!createMultipleMutation) return;
                createMultipleMutation.mutate(
                  data.rivens.map((riven) => ({
                    raw: riven.wfm_id,
                    override_existing: data.overrideExistingPrices,
                    price: riven.discount_price,
                    group: "riven",
                    tags: data.tags,
                    properties: {
                      min_price: riven.min_price,
                      last_updated: date,
                      potential_profit: riven.potential_profit,
                    },
                  })),
                );
                modals.closeAll();
              }}
            />
          ),
        });
      }}
      tradeEntry={tradeEntry}
      setTradeEntry={setTradeEntry}
      defaultDisplaySettings={{
        prefix: "WTB ",
        suffix: " :heart:",
        template: "[<link>] <type><variant><rank><amber_stars><cyan_stars><price>",
        displaySettings: {},
      }}
    />
  );
};

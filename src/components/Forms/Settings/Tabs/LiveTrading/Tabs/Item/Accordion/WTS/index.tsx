import { TauriTypes } from "$types";
import { TooltipIcon } from "@components/Shared/TooltipIcon";
import { useTranslateForms } from "@hooks/useTranslate.hook";
import { Box, Group, NumberInput } from "@mantine/core";
import { UseFormReturnType } from "@mantine/form";

export type WTSItemAccordionProps = {
  form: UseFormReturnType<TauriTypes.Settings>;
};

export const WTSItemAccordion = ({ form }: WTSItemAccordionProps) => {
  // Translate general
  const useTranslateForm = (key: string, context?: { [key: string]: any }, i18Key?: boolean) =>
    useTranslateForms(`settings.tabs.live_scraper.item.wts.${key}`, { ...context }, i18Key);
  const useTranslateFormFields = (key: string, context?: { [key: string]: any }, i18Key?: boolean) =>
    useTranslateForm(`fields.${key}`, { ...context }, i18Key);

  const getFieldPath = (field: string) => `live_scraper.items.wts.${field}`;
  return (
    <Box h="100%">
      <Group gap={"md"}>
        <NumberInput
          label={useTranslateFormFields("min_profit.label")}
          min={-1}
          max={999}
          placeholder={useTranslateFormFields("min_profit.placeholder")}
          rightSection={<TooltipIcon label={useTranslateFormFields("min_profit.tooltip")} link={useTranslateFormFields("min_profit.link")} />}
          radius="md"
          {...form.getInputProps(getFieldPath("min_profit"))}
        />
        <NumberInput
          label={useTranslateFormFields("min_profit_percentage.label")}
          min={-1}
          max={999}
          placeholder={useTranslateFormFields("min_profit_percentage.placeholder")}
          rightSection={<TooltipIcon label={useTranslateFormFields("min_profit_percentage.tooltip")} link={useTranslateFormFields("min_profit_percentage.link")} />}
          radius="md"
          {...form.getInputProps(getFieldPath("min_profit_percentage"))}
        />
        <NumberInput
          label={useTranslateFormFields("min_sma.label")}
          min={-1}
          placeholder={useTranslateFormFields("min_sma.placeholder")}
          rightSection={<TooltipIcon label={useTranslateFormFields("min_sma.tooltip")} link={useTranslateFormFields("min_sma.link")} />}
          radius="md"
          {...form.getInputProps(getFieldPath("min_sma"))}
        />
        <NumberInput
          label={useTranslateFormFields("max_price_drop.label")}
          min={-1}
          placeholder={useTranslateFormFields("max_price_drop.placeholder")}
          rightSection={<TooltipIcon label={useTranslateFormFields("max_price_drop.tooltip")} link={useTranslateFormFields("max_price_drop.link")} />}
          radius="md"
          {...form.getInputProps(getFieldPath("max_price_drop"))}
        />
        <NumberInput
          label={useTranslateFormFields("min_listings_below.label")}
          min={-1}
          placeholder={useTranslateFormFields("min_listings_below.placeholder")}
          rightSection={<TooltipIcon label={useTranslateFormFields("min_listings_below.tooltip")} link={useTranslateFormFields("min_listings_below.link")} />}
          radius="md"
          {...form.getInputProps(getFieldPath("min_listings_below"))}
        />
        <NumberInput
          label="Undercut by (plat)"
          min={0}
          rightSection={<TooltipIcon label="Void Trader lists this many plat below the cheapest seller so your order shows first. 0 matches them." />}
          radius="md"
          {...form.getInputProps(getFieldPath("undercut_step"))}
        />
        <NumberInput
          label="Stale after (days)"
          min={-1}
          rightSection={<TooltipIcon label="After this many days in stock, the minimum profit starts shrinking so stuck plat gets freed up. -1 turns this off." />}
          radius="md"
          {...form.getInputProps(getFieldPath("stale_after_days"))}
        />
        <NumberInput
          label="Stale decay per day (%)"
          min={0}
          rightSection={<TooltipIcon label="Percent of the minimum profit removed for each day an item is past the stale point." />}
          radius="md"
          {...form.getInputProps(getFieldPath("stale_decay_percentage"))}
        />
        <NumberInput
          label="Stale profit floor (plat)"
          min={-999}
          rightSection={<TooltipIcon label="The lowest profit a stale item will ever be listed at. Use a negative number to allow a stop-loss." />}
          radius="md"
          {...form.getInputProps(getFieldPath("stale_floor_profit"))}
        />
      </Group>
    </Box>
  );
};


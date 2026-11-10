import { QuantframeApiTypes, ResponseError } from "$types";
import api from "@api/index";
import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";

interface QueriesHooks {
  queryData: QuantframeApiTypes.RivenPriceControllerGetListParams;
  isActive?: boolean;
}

export const useQueries = ({ queryData, isActive }: QueriesHooks) => {
  // Void Trader: local data needs no date range (none = latest scan).
  const IsValid = () => {
    if (!isActive) return false;
    if (queryData.to_date && queryData.from_date) return new Date(queryData.from_date) <= new Date(queryData.to_date);
    return true;
  };
  // Pagination Query
  const getPaginationQuery = useQuery({
    queryKey: [
      "get_riven_pagination",
      queryData.from_date,
      queryData.to_date,
      queryData.page,
      queryData.limit,
      queryData.query,
      queryData.sort_by,
      queryData.sort_direction,
      queryData.volume_gt,
      queryData.volume_lt,
      queryData.min_price_gt,
      queryData.min_price_lt,
      queryData.max_price_gt,
      queryData.max_price_lt,
      queryData.avg_price_gt,
      queryData.avg_price_lt,
    ],
    queryFn: () => api.riven.getAll(queryData),
    retry: false,
    throwOnError(error: ResponseError, query) {
      if (error.properties?.error.status_code === 429) {
        notifications.show({
          title: "Error 429",
          color: "red.7",
          message: "You are sending too many requests. Please try again later.",
        });
      }
      console.error("Error in query:", query.queryKey, error);
      return false;
    },
    enabled: IsValid(),
  });
  const refetchQueries = () => {
    if (!IsValid()) return;
    getPaginationQuery.refetch();
  };

  // Return the queries
  return {
    paginationQuery: getPaginationQuery,
    refetchQueries,
  };
};

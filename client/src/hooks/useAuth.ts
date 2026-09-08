import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { SafeUser } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, isFetching } = useQuery<SafeUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    // Deliberately not `staleTime: 0`. Who the User is only changes when the
    // IdentityProvider session does, and `IdentityProviderSession` invalidates
    // this key on exactly that. With a stale-on-mount query, the two places
    // that read it (`ProviderSessionRouter` and `AuthPage`) refetch every time
    // the router swaps one for the other, and swapping on `isFetching` then
    // feeds itself: mount, refetch, unmount, mount — `/api/auth/user` in a
    // loop and a page stuck on the loading screen. `retryOnMount` is off for
    // the same reason: a query left in error state (the API down, a 500 from a
    // dropped database connection) otherwise refetches on every one of those
    // remounts, and the browser hammers a server that is already failing.
    retry: false,
    retryOnMount: false,
  });

  return {
    user,
    isLoading,
    isFetching,
    isAuthenticated: !!user,
  };
}

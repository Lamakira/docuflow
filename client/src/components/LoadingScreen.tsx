/** The app's one "not ready yet" screen: waiting on Clerk, or on who the User is. */
export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-pulse flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-lg bg-primary/20"></div>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

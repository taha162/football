import { Redirect } from "expo-router";
import { useAuth } from "../src/lib/auth";
import { Loading, Screen } from "../src/ui/kit";

/** Where the app opens: signed in, the home tab; else signing in. */
export default function Index() {
  const { ready, session, needsSecondStep, profile } = useAuth();
  if (!ready)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!session) return <Redirect href="/sign-in" />;
  if (needsSecondStep) return <Redirect href="/second-step" />;
  // A new account tells us how its member plays first (as the site's onboarding).
  if (profile && !profile.onboarded_at) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}

import { Redirect } from "expo-router";
import { useAuth } from "../src/lib/auth";
import { Loading, Screen } from "../src/ui/kit";

/** Where the app opens: signed in, the home tab; else signing in. */
export default function Index() {
  const { ready, session, needsSecondStep } = useAuth();
  if (!ready)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!session) return <Redirect href="/sign-in" />;
  if (needsSecondStep) return <Redirect href="/second-step" />;
  return <Redirect href="/(tabs)" />;
}

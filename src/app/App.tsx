import { RouterProvider } from "react-router";
import { AuthProvider } from "./AuthProvider";
import { router } from "./router";

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

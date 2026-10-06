import { createBrowserRouter, Outlet } from "react-router";

function RouteHydrateFallback() {
  return (
    <div className="route-fallback" role="status" aria-label="Loading page">
      <span />
    </div>
  );
}

function RootLayout() {
  return <Outlet />;
}

const loadHomePage = async () => ({
  Component: (await import("../pages/HomePage")).default,
});

export const router = createBrowserRouter([
  {
    path: "/",
    Component: RootLayout,
    HydrateFallback: RouteHydrateFallback,
    children: [
      {
        index: true,
        lazy: loadHomePage,
      },
      {
        path: "admin",
        lazy: async () => ({
          Component: (await import("../pages/AdminPage")).default,
        }),
      },
      {
        path: "admin/login",
        lazy: async () => ({
          Component: (await import("../pages/AdminLoginPage")).default,
        }),
      },
      {
        path: "*",
        lazy: loadHomePage,
      },
    ],
  },
]);

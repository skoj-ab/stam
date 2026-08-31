import { createBrowserRouter, RouterProvider } from "react-router";
import {
  AdminDirectoryRoute,
  ApiKeysRoute,
  adminDirectoryLoader,
  apiKeysLoader,
} from "./routes/AdministrationRoutes";
import {
  ApplicationIndexRoute,
  ApplicationLayoutRoute,
  applicationLoader,
  NotFoundRoute,
  RouteError,
} from "./routes/ApplicationLayoutRoute";
import {
  AcceptInvitationRoute,
  LoginRoute,
  loginLoader,
  SetupRoute,
  setupLoader,
} from "./routes/AuthRoutes";
import {
  CreateShareClassRoute,
  CreateShareholderRoute,
  createShareholderLoader,
  EditShareholderRoute,
  editShareholderLoader,
  ShareClassesRoute,
  ShareholdersRoute,
  shareClassesLoader,
  shareholdersLoader,
} from "./routes/CatalogRoutes";
import { CompaniesRoute, CompanySettingsRoute, CreateCompanyRoute } from "./routes/CompanyRoutes";
import { DesignSystemRoute } from "./routes/DesignSystemRoute";
import {
  EventFormRoute,
  EventHistoryRoute,
  eventFormLoader,
  eventHistoryLoader,
} from "./routes/EventRoutes";
import { FortnoxImportRoute } from "./routes/FortnoxImportRoute";
import { OcfExportRoute, OcfImportRoute, ocfExportLoader } from "./routes/OcfRoutes";
import {
  CurrentRegisterRoute,
  currentRegisterLoader,
  HistoricalRegisterRoute,
  historicalRegisterLoader,
} from "./routes/RegisterRoutes";

const router = createBrowserRouter([
  {
    path: "/design",
    element: <DesignSystemRoute />,
  },
  {
    path: "/login",
    loader: loginLoader,
    element: <LoginRoute />,
  },
  {
    path: "/setup",
    loader: setupLoader,
    element: <SetupRoute />,
  },
  {
    path: "/accept-invitation",
    element: <AcceptInvitationRoute />,
  },
  {
    id: "application",
    path: "/",
    loader: applicationLoader,
    element: <ApplicationLayoutRoute />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <ApplicationIndexRoute /> },
      {
        path: "admin/users",
        loader: adminDirectoryLoader,
        element: <AdminDirectoryRoute />,
      },
      {
        path: "account/api-keys",
        loader: apiKeysLoader,
        element: <ApiKeysRoute />,
      },
      { path: "companies", element: <CompaniesRoute /> },
      { path: "companies/new", element: <CreateCompanyRoute /> },
      { path: "companies/new/fortnox", element: <FortnoxImportRoute /> },
      { path: "companies/new/ocf", element: <OcfImportRoute /> },
      {
        path: "companies/:companyId/register",
        loader: currentRegisterLoader,
        element: <CurrentRegisterRoute />,
      },
      {
        path: "companies/:companyId/register/history",
        loader: historicalRegisterLoader,
        element: <HistoricalRegisterRoute />,
      },
      {
        path: "companies/:companyId/register/export/ocf",
        loader: ocfExportLoader,
        element: <OcfExportRoute />,
      },
      {
        path: "companies/:companyId/events",
        loader: eventHistoryLoader,
        element: <EventHistoryRoute />,
      },
      {
        path: "companies/:companyId/events/:eventType",
        loader: eventFormLoader,
        element: <EventFormRoute />,
      },
      {
        path: "companies/:companyId/shareholders",
        loader: shareholdersLoader,
        element: <ShareholdersRoute />,
      },
      {
        path: "companies/:companyId/shareholders/new",
        loader: createShareholderLoader,
        element: <CreateShareholderRoute />,
      },
      {
        path: "companies/:companyId/shareholders/:shareholderId/edit",
        loader: editShareholderLoader,
        element: <EditShareholderRoute />,
      },
      {
        path: "companies/:companyId/share-classes",
        loader: shareClassesLoader,
        element: <ShareClassesRoute />,
      },
      {
        path: "companies/:companyId/share-classes/new",
        element: <CreateShareClassRoute />,
      },
      {
        path: "companies/:companyId/settings",
        element: <CompanySettingsRoute />,
      },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

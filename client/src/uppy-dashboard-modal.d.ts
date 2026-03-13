declare module "@uppy/react/lib/DashboardModal" {
  import type { Body, Meta, Uppy } from "@uppy/core";
  import { Component } from "react";

  interface DashboardModalProps<M extends Meta, B extends Body> {
    uppy: Uppy<M, B>;
    onRequestClose?: () => void;
    open?: boolean;
    proudlyDisplayPoweredByUppy?: boolean;
    [key: string]: unknown;
  }

  class DashboardModal<M extends Meta, B extends Body> extends Component<DashboardModalProps<M, B>> {}
  export default DashboardModal;
}

import { createContext, useContext } from 'react';

export type ShowToast = (message: string) => void;

export const ToastApiContext = createContext<ShowToast>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastApiContext);
}

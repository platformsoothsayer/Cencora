"use client";

import { useEffect, useState } from "react";

/** True after the first client render. Charts wait for it so server and client markup match. */
export function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

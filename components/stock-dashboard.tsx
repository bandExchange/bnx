"use client";

import { useEffect } from "react";
import AppHeader from "@/components/app-header";
import {
  destroyStockApp,
  initStockApp,
} from "@/lib/stock-market/stock-app";
import "@/app/stock.css";

export default function StockDashboard() {
  useEffect(() => {
    initStockApp();
    return () => destroyStockApp();
  }, []);

  return (
    <div className="app stock-app">
      <AppHeader showFeedButton />

      <main className="main">
        <div className="chart-quote" id="chartQuote" />
        <div className="chart-toolbar">
          <div className="chart-tabs" id="companyTabs" />
        </div>
        <div className="chart-stack">
          <div className="chart-wrap chart-wrap--price">
            <canvas id="mainChart" />
          </div>
          <div className="chart-wrap chart-wrap--volume">
            <div className="chart-wrap__label" />
            <canvas id="volumeChart" />
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>본 사이트의 회사 및 주가 데이터는 모두 가상이며, 실제 투자와 무관합니다.</p>
      </footer>
    </div>
  );
}

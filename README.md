# HRT Recorder Web

HRT Recorder Web（HRT 网页记录工具）

A privacy-focused, web-based tool for simulating and tracking estradiol levels during Hormone Replacement Therapy (HRT).<br>

这是一个注重隐私的网页工具，用于在激素替代疗法（HRT）期间模拟和追踪雌二醇水平。

## Algorithm & Core Logic 算法逻辑

The pharmacokinetic algorithms, mathematical models, and parameters used in this simulation are derived directly from the **[HRT-Recorder-PKcomponent-Test](https://github.com/LaoZhong-Mihari/HRT-Recorder-PKcomponent-Test)** repository.<br>

本模拟中使用的药代动力学算法、数学模型与相关参数，直接来源于 **[HRT-Recorder-PKcomponent-Test](https://github.com/LaoZhong-Mihari/HRT-Recorder-PKcomponent-Test)** 仓库。

We strictly adhere to the `PKcore.swift` and `PKparameter.swift` logic provided by **@LaoZhong-Mihari**, ensuring that the web simulation matches the accuracy of the original native implementation (including 3-compartment models, two-part depot kinetics, and specific sublingual absorption tiers).<br>

我们严格遵循 **@LaoZhong-Mihari** 提供的 `PKcore.swift` 与 `PKparameter.swift` 中的逻辑，确保网页端模拟与原生实现在精度上保持一致（包括三室模型、双相肌注库房动力学以及特定的舌下吸收分层等）。

## Code Architecture 代码结构

The core logic has been split into small, focused modules so pharmacokinetics,
calibration, personal learning, and data encryption can evolve more safely and
be understood more quickly by new contributors.<br>

当前核心逻辑已经拆分为几个职责清晰的小模块，便于后续维护、继续贡献，以及让新协作者更快理解项目结构。<br>

Current module map:<br>
当前模块关系如下：<br>

* `types.ts` - Shared domain enums and interfaces such as `DoseEvent`, `LabResult`, and `SimulationResult`.<br>
  `types.ts`：共享的数据模型与类型定义，例如 `DoseEvent`、`LabResult`、`SimulationResult`。<br>

* `pk.ts` - Population PK constants, route-specific parameter resolution, the main simulation engine, and interpolation helpers.<br>
  `pk.ts`：基础药代参数、给药途径参数解析、主模拟引擎，以及插值工具。<br>

* `calibration.ts` - Lab unit conversion, legacy ratio-based calibration, and the Bayesian OU-Kalman calibration model.<br>
  `calibration.ts`：化验值单位转换、旧版比值校准，以及 Bayesian OU-Kalman 动态校准模型。<br>

* `personalModel.ts` - EKF-based personal learning, E2/CPA personalized estimation, and confidence interval generation.<br>
  `personalModel.ts`：基于 EKF 的个体化学习、E2/CPA 个体估算，以及置信区间生成。<br>

* `src/utils/dataEncryption.ts` - Generic AES-GCM helpers for import/export payload encryption.<br>
  `src/utils/dataEncryption.ts`：用于导入导出数据的通用 AES-GCM 加密工具。<br>

* `logic.ts` - Compatibility barrel file that re-exports the public API used by the UI.<br>
  `logic.ts`：兼容层与统一出口，对 UI 暴露稳定的公共接口。<br>

Dependency direction:<br>
依赖方向：<br>

`types.ts` → `pk.ts` → (`calibration.ts`, `personalModel.ts`) → `logic.ts`<br>

This keeps the mathematical foundation reusable while letting higher-level
calibration and personalization layers build on top of the same PK model
without duplicating formulas.<br>

这样可以保证药代数学底座只维护一份，而校准层与个体化学习层都能在同一套 PK 模型之上构建，避免重复实现和参数漂移。<br>

## Features 功能

* **Multi-Route Simulation**: Supports Injection (Valerate, Benzoate, Cypionate, Enanthate), Oral, Sublingual, Gel, and Patches.<br>

  **多给药途径模拟**：支持注射（戊酸酯 Valerate、苯甲酸酯 Benzoate、环戊丙酸酯 Cypionate、庚酸酯 Enanthate）、口服、舌下、凝胶以及贴片等多种给药方式。

* **Real-time Visualization**: Interactive charts showing estimated estradiol concentration (pg/mL) over time.<br>

  **实时可视化**：通过交互式图表展示随时间变化的雌二醇估算浓度（pg/mL）。

* **Sublingual Guidance**: Detailed "Hold Time" and absorption parameter ($\theta$) guidance based on strict medical modeling.<br>

  **舌下服用指导**：基于严格的医学建模，提供详细的“含服时间（Hold Time）”与吸收参数（$\theta$）参考。

* **Privacy First**: All data is stored locally in your browser's `localStorage` by default. If you create an account and sign in, optional automatic cloud sync uploads your encrypted-in-transit data payload to the project server (see `docs/api.md`); the security PIN is verified against the server and forgotten-PIN-encrypted cloud data cannot be recovered by anyone. Review the sync and deployment docs before enabling cloud features.<br>

  **隐私优先**：所有数据默认仅存储在你浏览器的 `localStorage` 中。若注册并登录账号，可选的自动云同步会将传输中加密的完整数据载荷上传至项目服务器（见 `docs/api.md`）；安全密码会提交服务端校验，且忘记密码后加密的云端数据无法被任何人恢复。启用云功能前请先阅读同步与部署文档。

* **Internationalization**: Native support for **Simplified Chinese** and **English**, **Cantonese**, **Russian, Ukrainian** and more.<br>

  **多语言支持**：原生支持多语言界面。

## 🧪 Run Locally 本地运行

This project is built with **React** and **TypeScript**. You can run it easily using a modern frontend tooling setup like [Vite](https://vitejs.dev/).<br>

本项目基于 **React** 与 **TypeScript** 构建，你可以使用诸如 [Vite](https://vitejs.dev/) 这样的现代前端工具链轻松运行它。

1. **Clone or Download** the files.<br>
   **Clone 或下载**项目文件到本地。

2. **Initialize a Vite project** (if starting from scratch):<br>
   **初始化一个 Vite 项目**（如果你是从零开始）：

   ```bash
   npm create vite@latest hrt-recorder -- --template react-ts
   cd hrt-recorder
   npm install
   ```

3. **Install Dependencies**:<br>
   **安装依赖**：

   ```bash
   npm install recharts lucide-react uuid @types/uuid clsx tailwind-merge
   ```

4. **Setup Tailwind CSS**:<br>
   **配置 Tailwind CSS**：

   Follow the [Tailwind CSS Vite Guide](https://tailwindcss.com/docs/guides/vite) to generate your `tailwind.config.js`.
   请按照 [Tailwind CSS 的 Vite 指南](https://tailwindcss.com/docs/guides/vite) 配置并生成你的 `tailwind.config.js` 文件。

5. **Add Code**:<br>
   **添加代码**：

   * Place `logic.ts` and `index.tsx` into your `src/` folder.<br>
     将 `logic.ts` 与 `index.tsx` 放入你的 `src/` 文件夹中。

   * Update `index.html` entry point if necessary.<br>
     如有需要，更新 `index.html` 中的入口配置。

6. **Run**:<br>
   **运行项目**：

   ```bash
   npm run dev
   ```

## Deployment & Hosting 部署与托管

You are **very welcome** to deploy this application to your own personal website, blog, or server!<br>

我们**非常欢迎**你将此应用部署到自己的个人网站、博客或服务器上！

We want this tool to be accessible to everyone who needs it. You do not need explicit permission to host it.<br>

我们希望所有需要这款工具的人都能方便地使用它。你无需额外获得授权即可自行托管与部署。

**Attribution Requirement:**

If you deploy this app publicly, please:<br>
如果你将该应用公开部署，请：

1. **Keep the original algorithm credits**: Visibly link back to the [HRT-Recorder-PKcomponent-Test](https://github.com/LaoZhong-Mihari/HRT-Recorder-PKcomponent-Test) repository.<br>

   **保留原始算法的鸣谢信息**：在显眼位置添加指向 [HRT-Recorder-PKcomponent-Test](https://github.com/LaoZhong-Mihari/HRT-Recorder-PKcomponent-Test) 仓库的链接。

2. **Respect the license**: Ensure you follow any licensing terms associated with the original algorithm code.<br>
   **遵守许可协议**：确保你遵循原始算法代码所适用的全部许可条款。

I wish you a smooth transition and Happy Estimating! 🏳️‍⚧️<br>
祝你性转顺利，快乐估测(>^ω^<)
<br>
同时，祝所有用此 webapp 的停经期女性身体健康 ❤️
<br>
At the same time, I wish good health to all the women using this web app who are going through menopause. ❤️
# TODO
-   [ ] Add Japanese language localization support
-   [ ] Add testosterone calculation support
-   [ ] 给每个人通过做六项后的数据进行校准，多次校准后改变动力学方程的参数

# LICENCE
本项目遵守 MIT Licence

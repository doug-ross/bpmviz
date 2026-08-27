/* ============================================================
   BRANDING â€” derived from futurestate.bpmn (AI-Assisted RPA Delivery)
   ============================================================ */

const BRANDING = {
  app: {
    name: 'BPMN Explorer',
    subtitle: 'Intelligent Automation Â· AI-Assisted RPA Delivery Â· Live',
    headerStatus: 'Telemetry connected Â· Automation CoE Â· FY26 Q2',
    brandMarkGradient: 'conic-gradient(from 220deg, #56c2a3, #a78bfa, #4dd0c1, #56c2a3)',
    brandMarkGlow: '0 0 18px rgba(86, 194, 163, .35)',
  },

  footer: {
    org: 'Â© 2026 PracticeOps Beta Â· RPA Delivery Data Model',
    linkText: 'linkedin.com/in/dougross',
    linkHref: 'https://linkedin.com/in/dougross',
  },

  copy: {
    sampleNoun: 'Automation',
    sampleListTitle: 'Active automations',
    sampleListUnit: 'in flight',
    startEventLabel: 'Request raised',
  },

  help: {
    title: 'BPMN Explorer Â· Help',
    subtitle: 'A 2.5D process viewer with replayable telemetry for RPA delivery and intelligent automation.',
    sections: [
      {
        title: 'Default view',
        body: `The default view spans <b>6 lanes</b> â€” Business, Intake / CoE, AI Assist,
        Business Analyst, Governance and Developer â€” tracing an automation request from
        the <b>Request raised</b> trigger, through AI-assisted scoping and PDD drafting,
        a parallel governance fan-out, then build, QA and UAT loops, ending at the
        <b>Live</b> deployment. It auto-plays at <b>1Ã— (slow-mo)</b> and the speed pill
        cycles 1Ã— â†’ 4Ã— â†’ 16Ã— â†’ 64Ã—.`
      },
      {
        title: 'Process variants by Automation',
        body: `Each sample exercises different gateway branches. <b>Invoice Capture Bot</b>
        runs the clean path (QA <i>Passed</i>, UAT <i>Accepted</i>) to Live. <b>Payroll
        Variance Bot</b> hits the QA <i>Defects</i> branch and is now stuck past SLA in a
        rework Develop Bot cycle, while <b>Statement Recon Bot</b> demonstrates the UAT
        <i>Rework</i> loop back to development before final acceptance.`
      },
      {
        title: 'Reading the active state',
        body: `The currently-active task has expanding cyan rings pulsing outward
        (sonar-style) and a brighter fill. The flow path leading into it animates
        with traveling cyan dashes. Completed paths turn solid green; pending paths stay dim.`
      }
    ],
    shortcutsTitle: 'Navigation',
    shortcuts: [
      ['Pan canvas', 'Click + drag'],
      ['Zoom', '<kbd>+</kbd> / <kbd>âˆ’</kbd> Â· scroll Â· <kbd>Shift</kbd>+<kbd>â†‘</kbd>/<kbd>â†“</kbd>'],
      ['Reset to default view', '<kbd>0</kbd> Â· Reset button'],
      ['Show entire diagram', '<kbd>F</kbd> Â· "All" button'],
      ['Inspect node', 'Single click on a node Â· double click to zoom in'],
      ['Minimap navigation', 'Click or drag in lower-right minimap'],
    ],
    playbackTitle: 'Playback',
    playback: [
      ['Play / pause', '<kbd>Space</kbd> Â· â–¶ button Â· click empty canvas'],
      ['Restart', '<kbd>R</kbd>'],
      ['Jump to current', '<kbd>E</kbd>'],
      ['Cycle speed', 'Click the speed pill (1Ã— slow-mo â†’ 4Ã— â†’ 16Ã— â†’ 64Ã—)'],
    ],
    togglesTitle: 'Toggles',
    toggles: [
      ['<b>Heat</b>', 'Tints lanes by current load â€” see where bottlenecks are concentrating.'],
      ['<b>Metrics</b>', 'Toggles inline SLA bars on tasks.'],
      ['<b>Labels</b>', 'Show / hide gateway-branch labels.'],
      ['<b>Stars</b>', 'Decorative background starfield.'],
    ]
  }
};

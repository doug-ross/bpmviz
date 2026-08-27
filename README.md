# bpmviz

## A simple visualizer for BPMN diagrams 

* Presentations: as-is and to-be process simulations
* Design: how will this process work – and who are the stakeholders?
* Support: enhanced telemetry capture could show real-time execution
* Audit: what happened during this business process?

In general, it's a simple way to offer transparency into operations across stakeholder groups.

## Sample

http://fpsbi.com/s/k2/bl2/

<img width="1920" height="990" alt="image" src="https://github.com/user-attachments/assets/ec21bbf4-20ba-47e8-9b0f-b4d4d7960895" />

## About BPMVIZ

* Self-contained HTML, CSS and JS solution
* Can run anywhere, even from a desktop (no web server needed, but it helps :-)
* Install in any folder
* index.htm is the default loader file and uses the following 

<img width="480" alt="image" src="https://github.com/user-attachments/assets/2dca03c7-9bcf-4d02-a3ee-acc64546bd11" />

## Creating your own

* Clone this repo
* Take any business process diagram (BPMN file, process diagram in a PDF, etc.) and feed it as input into...
* The *tools/bpmviz_creator_prompt.txt* - it will leverage any of the above and create all three JS files for you.
* Run the *index.htm* file in your browser or any web server to see it execute.


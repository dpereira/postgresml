import { Controller } from "@hotwired/stimulus"
import { renderModel, renderDistribution, renderCorrelation, renderOutliers } from "/static/js/main.mjs";

export default class extends Controller {
    static targets = [
      "step",
      "progressBar",
      "progressBarAmount",
      "sample",
      "tableStatus",
      "dataSourceNext",
      "projectStatus",
      "objective",
      "objectiveNameNext",
      "projectNameNext",
      "trainingLabel",
      "analysisNext",
      "algorithmListClassification",
      "algorithmListRegression",
      "analysisResult",
    ];

    initialize() {
        this.index = 0
        this.targetNames = new Set()
        this.algorithmNames = new Set()
    }

    renderSteps() {
        this.stepTargets.forEach((element, index) => {
            if (index !== this.index)
                element.classList.add("hidden")
            else
                element.classList.remove("hidden")
        })
    }

    renderProgressBar() {
      // Let's get stuck on 97 just like Windows Update... ;)
      if (this.progressBarInterval && this.progressBarProgress >= 95)
        clearInterval(this.progressBarInterval)

      this.progressBarProgress += 2
      const progress = Math.min(100, this.progressBarProgress)

      this.progressBarTarget.style = `width: ${progress > 0 ? progress : "auto"}%;`
      this.progressBarAmountTarget.innerHTML = `${progress}%`
    }

    checkDataSource(event) {
        let tableName = event.target.value

        fetch(`/api/tables/?table_name=${tableName}`)
        .then(res => {
            if (res.ok) {
                this.tableName = tableName
                this.renderSample()
                this.renderTarget()
            }
            else {
                this.tableName = null
                this.sampleTarget.innerHTML = ""
                this.trainingLabelTarget.innerHTML = ""
              }
            this.renderTableStatus()
        })
        .catch(err => {
            this.tableName = null
            this.renderTableStatus()
        })
    }

    checkProjectName(event) {
      let projectName = event.target.value

      fetch(`/api/projects/?name=${projectName}`)
      .then(res => res.json())
      .then(json => {
        if (json.results.length > 0) {
          this.projectName = null
        } else {
          this.projectName = projectName
        }

        this.renderProjectStatus()
      })
    }

    selectObjective(event) {
      event.preventDefault()

      this.objectiveName = event.currentTarget.dataset.objective

      if (this.objectiveName  === "regression") {
        this.algorithmListClassificationTarget.classList.add("hidden")
        this.algorithmListRegressionTarget.classList.remove("hidden")
      } else if (this.objectiveName  == "classification") {
        this.algorithmListClassificationTarget.classList.remove("hidden")
        this.algorithmListRegressionTarget.classList.add("hidden")
      }

      this.objectiveTargets.forEach(objective => {
        objective.classList.remove("selected")
      })

      event.currentTarget.classList.add("selected")
      this.objectiveNameNextTarget.disabled = false
    }

    selectAlgorithm(event) {
      event.preventDefault()

      let algorithmName = event.currentTarget.dataset.algorithm

      if (event.currentTarget.classList.contains("selected")) {
        event.currentTarget.classList.remove("selected")
        this.algorithmNames.delete(algorithmName)
      } else {
        event.currentTarget.classList.add("selected")
        this.algorithmNames.add(algorithmName)
      }

    }

    renderTableStatus() {
        if (this.tableName) {
            this.tableStatusTarget.innerHTML = "done"
            this.tableStatusTarget.classList.add("ok")
            this.tableStatusTarget.classList.remove("error")
            this.dataSourceNextTarget.disabled = false
        } else {
            this.tableStatusTarget.innerHTML = "close"
            this.tableStatusTarget.classList.add("error")
            this.tableStatusTarget.classList.remove("ok")
            this.dataSourceNextTarget.disabled = true
        }
        
    }

    renderProjectStatus() {
      if (this.projectName) {
            this.projectStatusTarget.innerHTML = "done"
            this.projectStatusTarget.classList.add("ok")
            this.projectStatusTarget.classList.remove("error")
            this.projectNameNextTarget.disabled = false
        } else {
            this.projectStatusTarget.innerHTML = "close"
            this.projectStatusTarget.classList.add("error")
            this.projectStatusTarget.classList.remove("ok")
            this.projectNameNextTarget.disabled = true
        }
    }

    renderSample() {
        fetch(`/api/tables/sample/?table_name=${this.tableName}`)
        .then(res => res.text())
        .then(html => this.sampleTarget.innerHTML = html)
    }

    renderTarget() {
      fetch(`/api/tables/columns/?table_name=${this.tableName}`)
      .then(res => res.text())
      .then(html => this.trainingLabelTarget.innerHTML = html)
    }

    renderAnalysisResult() {
      fetch(`/html/snapshots/analysis/?snapshot_id=${this.snapshotData.id}`)
      .then(res => res.text())
      .then(html => this.analysisResultTarget.innerHTML = html)
      .then(() => {
        // Render charts
        for (name in this.snapshotData.columns) {
          const sample = JSON.parse(document.getElementById(name).textContent)
          renderDistribution(name, sample, this.snapshotData.analysis[`${name}_dip`])

          for (target of this.snapshotData.y_column_name) {
            if (target === name)
              continue

            const targetSample = JSON.parse(document.getElementById(target).textContent)
            renderCorrelation(name, target, sample, targetSample)
          }
        }

        for (target of this.snapshotData.y_column_name) {
          const targetSample = JSON.parse(document.getElementById(target).textContent)
          renderOutliers(target, targetSample, this.snapshotData.analysis[`${target}_stddev`])
        }

        this.progressBarProgress = 100
        this.renderProgressBar()

        setTimeout(this.nextStep.bind(this), 1000)
      })
    }

    selectTarget(event) {
      event.preventDefault()
      let targetName = event.currentTarget.dataset.columnName

      if (event.currentTarget.classList.contains("selected")) {
        this.targetNames.delete(targetName)
        event.currentTarget.classList.remove("selected")
      } else {
        this.targetNames.add(targetName)
        event.currentTarget.classList.add("selected")
      }

      if (this.targetNames.size > 0)
        this.analysisNextTarget.disabled = false
      else
        this.analysisNextTarget.disabled = true
    }

    createSnapshot(event) {
      event.preventDefault()

      const request = {
        "relation_name": this.tableName,
        "y_column_name": Array.from(this.targetNames),
      }

      this.nextStep()

      // Start the progress bar :)
      this.progressBarProgress = 2
      this.progressBarInterval = setInterval(this.renderProgressBar.bind(this), 750)
      console.log("interval set to ", this.progressBarInterval)

      fetch(`/api/snapshots/snapshot/`, {
        method: "POST",
        cache: "no-cache",
        headers: {
          "Content-Type": "application/json",
        },
        redirect: "follow",
        body: JSON.stringify(request),
      })
      .then(res => {
        if (res.ok) {
          return res.json()
        } else {
          alert("Failed to create snapshot")
          throw Error("Failed to create snapshot")
        }
      })
      .then(json => {
        this.snapshotData = json
        this.renderAnalysisResult()
      })
    }

    createProject(event) {
      event.preventDefault()

      const request = {
        "project_name": this.projectName,
        "objective": this.objectiveName,
        "algorithms": Array.from(this.algorithmNames),
        "snapshot_id": this.snapshotData.id,
      }

      this.createLoader()

      fetch(`/api/projects/train/`, {
        method: "POST",
        cache: "no-cache",
        headers: {
          "Content-Type": "application/json",
        },
        redirect: "follow",
        body: JSON.stringify(request),
      })
      .then(res => {
        if (res.ok) {
          return res.json()
        } else {
          alert("Failed to train project");
          throw Error("Failed to train project")
        }
      })
      .then(json => {
        window.location.assign(`/projects/${json.id}`);
      })
    }

    createLoader() {
      let element = document.createElement("div")
      element.innerHTML = `
        <div id="loader">
          <div class="loader"></div>
        </div>
      `;
      document.body.appendChild(element)
    }

    nextStep() {
        this.index += 1
        this.renderSteps()
    }

    previousStep() {
        this.index -= 1
        this.renderSteps()
    }
}

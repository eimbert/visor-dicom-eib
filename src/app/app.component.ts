import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import * as cornerstone from 'cornerstone-core';
import * as cornerstoneTools from 'cornerstone-tools';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as dicomParser from 'dicom-parser';
import * as Hammer from 'hammerjs';
import * as JSZip from 'jszip';

interface DicomTagRow {
  tag: string;
  vr: string;
  name: string;
  value: string;
}

interface StructuredReportLine {
  level: number;
  label: string;
  value: string;
}

interface DicomInstance {
  id: string;
  file: File;
  imageId?: string;
  fileName: string;
  modality: string;
  studyDescription: string;
  studyInstanceUid: string;
  seriesDescription: string;
  seriesInstanceUid: string;
  seriesNumber: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  instanceNumber: string;
  sopInstanceUid: string;
  tags: DicomTagRow[];
  dataSet: any;
  isWaveform: boolean;
  isPdf: boolean;
  isStructuredReport: boolean;
  documentUrl?: string;
  documentTitle: string;
  mimeType: string;
}

interface InstanceGroup {
  key: string;
  label: string;
  instances: DicomInstance[];
}

interface StudyGroup {
  key: string;
  label: string;
  series: InstanceGroup[];
}

interface PatientGroup {
  key: string;
  label: string;
  studies: StudyGroup[];
}

type ViewerMode = 'empty' | 'image' | 'waveform' | 'pdf' | 'sr';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements AfterViewInit, OnDestroy {
  title = 'visor-dicom-eib';
  @ViewChild('viewerShell', { static: true }) viewerShell!: ElementRef<HTMLElement>;
  @ViewChild('dicomViewport', { static: true }) dicomViewport!: ElementRef<HTMLDivElement>;
  @ViewChild('ecgCanvas', { static: true }) ecgCanvas!: ElementRef<HTMLCanvasElement>;

  constructor(private sanitizer: DomSanitizer) {}

  instances: DicomInstance[] = [];
  patientGroups: PatientGroup[] = [];
  expandedTreeKeys = new Set<string>();
  selectedIndex = -1;
  selected?: DicomInstance;
  filteredTags: DicomTagRow[] = [];
  tagFilter = '';
  activeTool = 'Wwwc';
  viewerMode: ViewerMode = 'empty';
  isDragging = false;
  loading = false;
  statusMessage = 'Carga ficheros DICOM para empezar';
  zoom = 100;
  windowCenter = 0;
  windowWidth = 0;
  ecgInfo = 'Sin waveform cargada';
  renderError = '';
  safePdfUrl?: SafeResourceUrl;
  structuredReportLines: StructuredReportLine[] = [];
  isPlaying = false;
  showAboutDialog = false;
  tagPanelWidth = 430;
  readonly studyPanelWidth = 344;
  resizingTagPanel = false;
  private playbackTimer?: ReturnType<typeof setInterval>;
  private readonly playbackDelay = 350;
  private toolsRegistered = false;

  readonly tagNames: Record<string, string> = {
    x00020000: 'File Meta Information Group Length',
    x00020001: 'File Meta Information Version',
    x00020002: 'Media Storage SOP Class UID',
    x00020003: 'Media Storage SOP Instance UID',
    x00020010: 'Transfer Syntax UID',
    x00020012: 'Implementation Class UID',
    x00020013: 'Implementation Version Name',
    x00080005: 'Specific Character Set',
    x00080008: 'Image Type',
    x00080016: 'SOP Class UID',
    x00080018: 'SOP Instance UID',
    x00080020: 'Study Date',
    x00080021: 'Series Date',
    x00080022: 'Acquisition Date',
    x00080023: 'Content Date',
    x00080030: 'Study Time',
    x00080031: 'Series Time',
    x00080032: 'Acquisition Time',
    x00080050: 'Accession Number',
    x00080060: 'Modality',
    x00080070: 'Manufacturer',
    x00080080: 'Institution Name',
    x00080090: 'Referring Physician Name',
    x00081010: 'Station Name',
    x00081030: 'Study Description',
    x0008103e: 'Series Description',
    x00100010: 'Patient Name',
    x00100020: 'Patient ID',
    x00100030: 'Patient Birth Date',
    x00100040: 'Patient Sex',
    x00081090: 'Manufacturer Model Name',
    x00081111: 'Referenced Performed Procedure Step Sequence',
    x00081150: 'Referenced SOP Class UID',
    x00081155: 'Referenced SOP Instance UID',
    x00100021: 'Issuer Of Patient ID',
    x00100022: 'Type Of Patient ID',
    x0020000d: 'Study Instance UID',
    x0020000e: 'Series Instance UID',
    x00200010: 'Study ID',
    x00200011: 'Series Number',
    x00200013: 'Instance Number',
    x0040a040: 'Value Type',
    x0040a043: 'Concept Name Code Sequence',
    x0040a050: 'Continuity Of Content',
    x0040a073: 'Verifying Observer Sequence',
    x0040a075: 'Verifying Observer Name',
    x0040a088: 'Verifying Observer Identification Code Sequence',
    x0040a120: 'DateTime',
    x0040a121: 'Date',
    x0040a122: 'Time',
    x0040a123: 'Person Name',
    x0040a124: 'UID',
    x0040a130: 'Temporal Range Type',
    x0040a132: 'Referenced Sample Positions',
    x0040a136: 'Referenced Frame Numbers',
    x0040a160: 'Text Value',
    x0040a168: 'Concept Code Sequence',
    x0040a170: 'Purpose Of Reference Code Sequence',
    x0040a300: 'Measured Value Sequence',
    x0040a30a: 'Numeric Value',
    x0040a730: 'Content Sequence',
    x004008ea: 'Measurement Units Code Sequence',
    x00420010: 'Document Title',
    x00420011: 'Encapsulated Document',
    x00420012: 'MIME Type Of Encapsulated Document',
    x00280010: 'Rows',
    x00280011: 'Columns',
    x00280100: 'Bits Allocated',
    x00281050: 'Window Center',
    x00281051: 'Window Width',
    x003a0005: 'Number Of Waveform Channels',
    x003a0010: 'Number Of Waveform Samples',
    x003a001a: 'Sampling Frequency',
    x003a0200: 'Channel Definition Sequence',
    x003a0203: 'Channel Label',
    x54000100: 'Waveform Sequence',
    x54001004: 'Waveform Bits Allocated',
    x54001006: 'Waveform Sample Interpretation',
    x54001010: 'Waveform Data',
    x7fe00010: 'Pixel Data'
  };

  ngAfterViewInit(): void {
    this.configureCornerstone();
  }

  ngOnDestroy(): void {
    this.stopPlayback();
    this.releaseDocumentUrls();
    this.detachResizeListeners();
  }

  async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) {
      return;
    }
    await this.loadFiles(Array.from(input.files));
    input.value = '';
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragging = false;
    const files = Array.from(event.dataTransfer?.files || []);
    await this.loadFiles(files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(): void {
    this.isDragging = false;
  }

  startTagPanelResize(event: PointerEvent): void {
    event.preventDefault();
    this.resizingTagPanel = true;
    const target = event.currentTarget as HTMLElement | null;
    target?.setPointerCapture?.(event.pointerId);
    document.addEventListener('pointermove', this.onTagPanelResize);
    document.addEventListener('pointerup', this.stopTagPanelResize);
    document.addEventListener('pointercancel', this.stopTagPanelResize);
    this.updateTagPanelWidth(event.clientX);
  }

  private readonly onTagPanelResize = (event: PointerEvent): void => {
    event.preventDefault();
    this.updateTagPanelWidth(event.clientX);
  };

  private readonly stopTagPanelResize = (): void => {
    this.resizingTagPanel = false;
    this.detachResizeListeners();
    this.resizeActiveViewport();
  };

  private updateTagPanelWidth(clientX: number): void {
    const minTagWidth = 300;
    const minViewportWidth = 420;
    const maxTagWidth = Math.max(minTagWidth, window.innerWidth - this.studyPanelWidth - minViewportWidth - 8);
    const wantedWidth = window.innerWidth - clientX;
    this.tagPanelWidth = Math.min(Math.max(wantedWidth, minTagWidth), maxTagWidth);
    this.viewerShell.nativeElement.style.setProperty('--tag-panel-width', `${this.tagPanelWidth}px`);
    this.resizeActiveViewport();
  }

  private detachResizeListeners(): void {
    document.removeEventListener('pointermove', this.onTagPanelResize);
    document.removeEventListener('pointerup', this.stopTagPanelResize);
    document.removeEventListener('pointercancel', this.stopTagPanelResize);
  }

  private resizeActiveViewport(): void {
    requestAnimationFrame(() => {
      if (this.viewerMode === 'image') {
        try {
          cornerstone.resize(this.dicomViewport.nativeElement, true);
          this.syncViewportInfo();
        } catch {
          // The image viewport may not be enabled yet.
        }
      } else if (this.viewerMode === 'waveform' && this.selected) {
        this.renderWaveform(this.selected);
      }
    });
  }

  async loadFiles(files: File[]): Promise<void> {
    const dicomFiles = files.filter(file => file.size > 0);
    if (!dicomFiles.length) {
      this.statusMessage = 'No se han encontrado ficheros validos';
      return;
    }

    this.stopPlayback();

    this.loading = true;
    this.statusMessage = `Leyendo ${dicomFiles.length} fichero(s) DICOM`;

    const parsed: DicomInstance[] = [];
    for (const file of dicomFiles) {
      try {
        parsed.push(await this.parseDicomFile(file));
      } catch (error) {
        console.error(error);
      }
    }

    this.instances = parsed.sort((a, b) => this.compareInstances(a, b));
    this.patientGroups = this.buildPatientGroups(this.instances);
    this.expandAllTreeGroups();
    this.loading = false;

    if (!this.instances.length) {
      this.statusMessage = 'No se pudo leer ningun DICOM';
      return;
    }

    this.statusMessage = `${this.instances.length} instancia(s) cargada(s)`;
    await this.selectInstance(0);
  }

  async selectInstance(index: number): Promise<void> {
    if (index < 0 || index >= this.instances.length) {
      return;
    }

    this.selectedIndex = index;
    this.selected = this.instances[index];
    this.tagFilter = '';
    this.filteredTags = this.selected.tags;
    this.renderError = '';
    this.safePdfUrl = undefined;
    this.structuredReportLines = [];

    if (this.selected.isStructuredReport) {
      this.viewerMode = 'sr';
      try {
        cornerstone.disable(this.dicomViewport.nativeElement);
      } catch {
        // The viewport may not be enabled yet.
      }
      this.structuredReportLines = this.extractStructuredReport(this.selected.dataSet);
      this.statusMessage = `Informe SR cargado: ${this.selected.seriesDescription || this.selected.studyDescription || this.selected.fileName}`;
      return;
    }

    if (this.selected.isPdf && this.selected.documentUrl) {
      this.viewerMode = 'pdf';
      try {
        cornerstone.disable(this.dicomViewport.nativeElement);
      } catch {
        // The viewport may not be enabled yet.
      }
      this.safePdfUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.selected.documentUrl);
      this.statusMessage = `Documento cargado: ${this.selected.documentTitle || this.selected.fileName}`;
      return;
    }

    if (this.selected.isWaveform) {
      this.viewerMode = 'waveform';
      try {
        cornerstone.disable(this.dicomViewport.nativeElement);
      } catch {
        // The viewport may not be enabled yet.
      }
      await this.waitForViewport();
      this.renderWaveform(this.selected);
      return;
    }

    if (!this.selected.imageId) {
      this.viewerMode = 'empty';
      this.renderError = 'Esta instancia no contiene Pixel Data, Waveform ni documento encapsulado legible.';
      this.statusMessage = this.renderError;
      return;
    }

    this.viewerMode = 'image';
    await this.waitForViewport();

    try {
      const element = this.dicomViewport.nativeElement;
      this.ensureCornerstoneEnabled(element);
      const image = await cornerstone.loadAndCacheImage(this.selected.imageId);
      cornerstone.displayImage(element, image);
      cornerstone.resize(element, true);
      this.syncViewportInfo();
      this.setActiveTool(this.activeTool);
      this.statusMessage = `Instancia ${this.selectedIndex + 1} cargada`;
    } catch (error) {
      console.error(error);
      this.renderError = 'No se pudo decodificar la imagen DICOM. Revisa la sintaxis de transferencia o codecs.';
      this.statusMessage = this.renderError;
    }
  }

  nextInstance(): void {
    this.selectInstance(Math.min(this.selectedIndex + 1, this.instances.length - 1));
  }

  previousInstance(): void {
    this.selectInstance(Math.max(this.selectedIndex - 1, 0));
  }

  openAboutDialog(): void {
    this.showAboutDialog = true;
  }

  closeAboutDialog(): void {
    this.showAboutDialog = false;
  }

  togglePlayback(): void {
    if (this.isPlaying) {
      this.stopPlayback();
      return;
    }

    if (this.instances.length < 2) {
      this.statusMessage = 'Carga al menos dos instancias para reproducir la secuencia';
      return;
    }

    this.isPlaying = true;
    this.statusMessage = 'Reproduciendo secuencia en bucle';
    this.playbackTimer = setInterval(() => this.advancePlayback(), this.playbackDelay);
  }

  stopPlayback(): void {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = undefined;
    }
    this.isPlaying = false;
  }

  private advancePlayback(): void {
    if (!this.instances.length) {
      this.stopPlayback();
      return;
    }
    const nextIndex = (this.selectedIndex + 1) % this.instances.length;
    this.selectInstance(nextIndex);
  }

  toggleTreeNode(key: string): void {
    if (this.expandedTreeKeys.has(key)) {
      this.expandedTreeKeys.delete(key);
      return;
    }
    this.expandedTreeKeys.add(key);
  }

  isTreeNodeExpanded(key: string): boolean {
    return this.expandedTreeKeys.has(key);
  }

  private expandAllTreeGroups(): void {
    this.expandedTreeKeys.clear();
    this.patientGroups.forEach(patient => {
      this.expandedTreeKeys.add(patient.key);
      patient.studies.forEach(study => {
        this.expandedTreeKeys.add(study.key);
        study.series.forEach(series => this.expandedTreeKeys.add(series.key));
      });
    });
  }

  async downloadAllInstances(): Promise<void> {
    if (!this.instances.length) {
      this.statusMessage = 'No hay instancias cargadas para descargar';
      return;
    }

    const zip = new JSZip();
    this.instances.forEach((instance, index) => {
      const safeName = instance.fileName?.trim() || `instancia-${index + 1}.dcm`;
      zip.file(this.prefixFileName(index, safeName), instance.file);
    });

    this.statusMessage = 'Preparando descarga DICOM...';
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.buildZipName();
    link.click();
    URL.revokeObjectURL(url);
    this.statusMessage = `${this.instances.length} instancia(s) descargada(s)`;
  }

  clearStudy(): void {
    this.stopPlayback();
    this.releaseDocumentUrls();
    this.instances = [];
    this.patientGroups = [];
    this.expandedTreeKeys.clear();
    this.selectedIndex = -1;
    this.selected = undefined;
    this.filteredTags = [];
    this.tagFilter = '';
    this.viewerMode = 'empty';
    this.renderError = '';
    this.safePdfUrl = undefined;
    this.structuredReportLines = [];
    this.ecgInfo = 'Sin waveform cargada';
    this.zoom = 100;
    this.windowCenter = 0;
    this.windowWidth = 0;
    this.statusMessage = 'Carga ficheros DICOM para empezar';

    try {
      cornerstone.disable(this.dicomViewport.nativeElement);
    } catch {
      // The viewport may not be enabled.
    }

    const canvas = this.ecgCanvas.nativeElement;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  resetViewport(): void {
    if (this.viewerMode === 'image') {
      cornerstone.reset(this.dicomViewport.nativeElement);
      this.syncViewportInfo();
    } else if (this.selected?.isWaveform) {
      this.renderWaveform(this.selected);
    }
  }

  invertViewport(): void {
    if (this.viewerMode !== 'image') {
      return;
    }
    const viewport = cornerstone.getViewport(this.dicomViewport.nativeElement);
    viewport.invert = !viewport.invert;
    cornerstone.setViewport(this.dicomViewport.nativeElement, viewport);
  }

  setActiveTool(toolName: string): void {
    this.activeTool = toolName;

    if (this.viewerMode !== 'image') {
      this.statusMessage = 'Las herramientas se activan sobre imagen DICOM';
      return;
    }

    const element = this.dicomViewport.nativeElement;
    const tools: any = cornerstoneTools;
    this.ensureCornerstoneEnabled(element);

    ['Wwwc', 'Pan', 'Zoom', 'Length', 'Probe'].forEach(name => {
      if (tools.setToolPassiveForElement) {
        tools.setToolPassiveForElement(element, name);
      }
    });

    if (tools.setToolActiveForElement) {
      tools.setToolActiveForElement(element, toolName, { mouseButtonMask: 1 });
      if (toolName !== 'Pan') {
        tools.setToolActiveForElement(element, 'Pan', { mouseButtonMask: 2 });
      }
    }

    if (tools.setToolEnabledForElement && tools.ZoomMouseWheelTool) {
      tools.setToolEnabledForElement(element, 'ZoomMouseWheel');
    }

    const labels: Record<string, string> = {
      Wwwc: 'Window/level',
      Pan: 'Pan',
      Zoom: 'Zoom',
      Length: 'Medir',
      Probe: 'Probe'
    };
    this.statusMessage = `Herramienta activa: ${labels[toolName] || toolName}`;
  }

  filterTags(): void {
    const query = this.tagFilter.trim().toLowerCase();
    if (!this.selected || !query) {
      this.filteredTags = this.selected?.tags || [];
      return;
    }
    this.filteredTags = this.selected.tags.filter(row =>
      row.tag.toLowerCase().includes(query) ||
      row.name.toLowerCase().includes(query) ||
      row.value.toLowerCase().includes(query)
    );
  }

  get studyTitle(): string {
    if (!this.selected) {
      return 'Sin estudio cargado';
    }
    return this.selected.studyDescription || this.selected.seriesDescription || 'Estudio DICOM';
  }

  get imageCounter(): string {
    if (!this.instances.length) {
      return '0 / 0';
    }
    return `${this.selectedIndex + 1} / ${this.instances.length}`;
  }

  private configureCornerstone(): void {
    const loader: any = cornerstoneWADOImageLoader;
    const tools: any = cornerstoneTools;

    loader.external.cornerstone = cornerstone;
    loader.external.dicomParser = dicomParser;
    loader.configure({ useWebWorkers: true });
    loader.webWorkerManager.initialize({
      webWorkerPath: 'assets/cornerstone/index.worker.bundle.min.worker.js',
      maxWebWorkers: navigator.hardwareConcurrency || 2,
      startWebWorkersOnDemand: true,
      taskConfiguration: {
        decodeTask: {
          initializeCodecsOnStartup: false,
          usePDFJS: false
        }
      }
    });

    tools.external.cornerstone = cornerstone;
    tools.external.Hammer = Hammer;
    tools.init({ showSVGCursors: true });

    [
      tools.WwwcTool,
      tools.PanTool,
      tools.ZoomTool,
      tools.LengthTool,
      tools.ProbeTool
    ].forEach((tool: any) => {
      if (tool) {
        tools.addTool(tool);
      }
    });
  }

  private buildZipName(): string {
    const base = [
      this.selected?.patientName,
      this.selected?.studyDescription || this.selected?.seriesDescription,
      'dicom'
    ]
      .filter(Boolean)
      .join('-')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return `${base || 'instancias-dicom'}.zip`;
  }

  private prefixFileName(index: number, fileName: string): string {
    const clean = fileName.replace(/[\\/:*?"<>|]+/g, '_');
    return `${String(index + 1).padStart(4, '0')}_${clean}`;
  }

  private waitForViewport(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  private ensureCornerstoneEnabled(element: HTMLElement): void {
    try {
      cornerstone.getEnabledElement(element);
    } catch {
      cornerstone.enable(element);
    }
    this.registerImageTools(element);
  }

  private registerImageTools(element: HTMLElement): void {
    if (this.toolsRegistered) {
      return;
    }

    const tools: any = cornerstoneTools;
    [
      tools.WwwcTool,
      tools.PanTool,
      tools.ZoomTool,
      tools.ZoomMouseWheelTool,
      tools.LengthTool,
      tools.ProbeTool
    ].forEach((tool: any) => {
      if (!tool) {
        return;
      }
      try {
        if (tools.addToolForElement) {
          tools.addToolForElement(element, tool);
        } else if (tools.addTool) {
          tools.addTool(tool);
        }
      } catch {
        // Tool may already be registered for this viewport.
      }
    });

    this.toolsRegistered = true;
  }

  private async parseDicomFile(file: File): Promise<DicomInstance> {
    const buffer = await file.arrayBuffer();
    const byteArray = new Uint8Array(buffer);
    const dataSet = dicomParser.parseDicom(byteArray);
    const hasWaveform = this.hasWaveformData(dataSet);
    const hasPixelData = Boolean(dataSet.elements['x7fe00010']);
    const isStructuredReport = this.isStructuredReport(dataSet);
    const isWaveform = hasWaveform && !hasPixelData && !isStructuredReport;
    const loader: any = cornerstoneWADOImageLoader;
    const imageId = hasPixelData ? loader.wadouri.fileManager.add(file) : undefined;
    const tags = this.extractTags(dataSet);

    const embeddedDocument = this.extractEmbeddedDocument(dataSet);
    const isPdf = Boolean(embeddedDocument);
    const modality = this.getString(dataSet, 'x00080060') || (isWaveform ? 'ECG' : (isPdf ? 'DOC' : (isStructuredReport ? 'SR' : '')));

    return {
      id: this.getString(dataSet, 'x00080018') || file.name,
      file,
      imageId,
      fileName: file.name,
      modality,
      studyDescription: this.getString(dataSet, 'x00081030'),
      studyInstanceUid: this.getString(dataSet, 'x0020000d'),
      seriesDescription: this.getString(dataSet, 'x0008103e'),
      seriesInstanceUid: this.getString(dataSet, 'x0020000e'),
      seriesNumber: this.getString(dataSet, 'x00200011'),
      patientName: this.formatPersonName(this.getString(dataSet, 'x00100010')),
      patientId: this.getString(dataSet, 'x00100020'),
      studyDate: this.formatDicomDate(this.getString(dataSet, 'x00080020')),
      instanceNumber: this.getString(dataSet, 'x00200013'),
      sopInstanceUid: this.getString(dataSet, 'x00080018'),
      tags,
      dataSet,
      isWaveform,
      isPdf,
      isStructuredReport,
      documentUrl: embeddedDocument?.url,
      documentTitle: this.getString(dataSet, 'x00420010') || embeddedDocument?.title || '',
      mimeType: embeddedDocument?.mimeType || ''
    };
  }

  private compareInstances(a: DicomInstance, b: DicomInstance): number {
    return this.sortValue(a.patientName).localeCompare(this.sortValue(b.patientName)) ||
      this.sortValue(a.studyDate).localeCompare(this.sortValue(b.studyDate)) ||
      this.sortValue(a.studyDescription).localeCompare(this.sortValue(b.studyDescription)) ||
      Number(a.seriesNumber || 0) - Number(b.seriesNumber || 0) ||
      this.sortValue(a.seriesDescription).localeCompare(this.sortValue(b.seriesDescription)) ||
      Number(a.instanceNumber || 0) - Number(b.instanceNumber || 0) ||
      a.fileName.localeCompare(b.fileName);
  }

  private buildPatientGroups(instances: DicomInstance[]): PatientGroup[] {
    const patientMap = new Map<string, PatientGroup>();
    instances.forEach(instance => {
      const patientKey = instance.patientId || instance.patientName || 'patient-unknown';
      const studyKey = instance.studyInstanceUid || `${patientKey}|${instance.studyDate}|${instance.studyDescription}`;
      const seriesKey = instance.seriesInstanceUid || `${studyKey}|${instance.seriesNumber}|${instance.seriesDescription}`;

      let patient = patientMap.get(patientKey);
      if (!patient) {
        patient = { key: patientKey, label: instance.patientName || 'Paciente sin nombre', studies: [] };
        patientMap.set(patientKey, patient);
      }

      let study = patient.studies.find(item => item.key === studyKey);
      if (!study) {
        const date = instance.studyDate ? ` (${instance.studyDate})` : '';
        study = { key: studyKey, label: `${instance.studyDescription || 'Estudio sin descripcion'}${date}`, series: [] };
        patient.studies.push(study);
      }

      let series = study.series.find(item => item.key === seriesKey);
      if (!series) {
        series = { key: seriesKey, label: instance.seriesDescription || instance.documentTitle || 'Serie sin descripcion', instances: [] };
        study.series.push(series);
      }

      series.instances.push(instance);
    });

    return Array.from(patientMap.values());
  }

  private releaseDocumentUrls(): void {
    this.instances.forEach(instance => {
      if (instance.documentUrl) {
        URL.revokeObjectURL(instance.documentUrl);
      }
    });
    this.safePdfUrl = undefined;
  }

  private extractEmbeddedDocument(dataSet: any): { url: string; mimeType: string; title: string } | undefined {
    const element = dataSet.elements?.['x00420011'];
    if (!element?.length) {
      return undefined;
    }
    const mimeType = this.getString(dataSet, 'x00420012') || 'application/pdf';
    if (!mimeType.toLowerCase().includes('pdf')) {
      return undefined;
    }
    const bytes = dataSet.byteArray.slice(element.dataOffset, element.dataOffset + element.length);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return {
      url: URL.createObjectURL(blob),
      mimeType,
      title: this.getString(dataSet, 'x00420010')
    };
  }

  private sortValue(value: string): string {
    return (value || '').toLowerCase();
  }

  private extractTags(dataSet: any): DicomTagRow[] {
    return Object.keys(dataSet.elements)
      .sort()
      .map(tag => {
        const element = dataSet.elements[tag];
        return {
          tag: this.formatTag(tag),
          vr: element.vr || '',
          name: this.tagNames[tag] || 'DICOM tag',
          value: this.getDisplayValue(dataSet, tag, element)
        };
      });
  }

  private getDisplayValue(dataSet: any, tag: string, element: any): string {
    if (element.items) {
      return `Sequence (${element.items.length} item${element.items.length === 1 ? '' : 's'})`;
    }
    if (tag === 'x7fe00010') {
      return `Pixel Data (${element.length} bytes)`;
    }
    if (tag === 'x54001010') {
      return `Waveform Data (${element.length} bytes)`;
    }
    if (tag === 'x00420011') {
      return `Encapsulated Document (${element.length} bytes)`;
    }
    const value = this.getString(dataSet, tag);
    if (value) {
      return value.length > 240 ? `${value.slice(0, 240)}...` : value;
    }
    return element.length ? `${element.length} bytes` : '';
  }

  private renderWaveform(instance: DicomInstance): void {
    const canvas = this.ecgCanvas.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(900, Math.floor(rect.width * dpr));
    canvas.height = Math.max(560, Math.floor(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    this.drawEcgGrid(context, width, height);

    const waveform = this.extractWaveform(instance.dataSet);
    if (!waveform.samples.length) {
      context.fillStyle = '#d8dee9';
      context.font = '16px Segoe UI';
      context.fillText('No se pudo extraer WaveformData de este ECG.', 28, 46);
      this.ecgInfo = 'Waveform no disponible';
      return;
    }

    const visibleChannels = Math.min(waveform.channels, 12);
    const rowHeight = (height - 70) / visibleChannels;
    const left = 52;
    const right = width - 24;
    const samplesToDraw = Math.min(waveform.samplesPerChannel, 5000);
    const channelNames = waveform.channelLabels.length ? waveform.channelLabels : this.defaultEcgLabels(visibleChannels);

    context.lineWidth = 1.35;
    context.strokeStyle = '#101418';
    context.fillStyle = '#222831';
    context.font = '12px Segoe UI';

    for (let channel = 0; channel < visibleChannels; channel++) {
      const top = 38 + channel * rowHeight;
      const mid = top + rowHeight / 2;
      const values = waveform.samples[channel] || [];
      const max = Math.max(1, ...values.slice(0, samplesToDraw).map(value => Math.abs(value)));
      const scale = (rowHeight * 0.38) / max;

      context.fillText(channelNames[channel] || `CH ${channel + 1}`, 12, mid + 4);
      context.beginPath();
      for (let i = 0; i < samplesToDraw; i++) {
        const x = left + (i / Math.max(1, samplesToDraw - 1)) * (right - left);
        const y = mid - values[i] * scale;
        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.stroke();
    }

    this.ecgInfo = `${waveform.channels} canales | ${waveform.samplesPerChannel} muestras | ${waveform.samplingFrequency || '?'} Hz`;
  }

  private extractWaveform(dataSet: any): {
    channels: number;
    samplesPerChannel: number;
    samplingFrequency: string;
    channelLabels: string[];
    samples: number[][];
  } {
    const waveformSequence = dataSet.elements['x54000100'];
    const firstItem = waveformSequence?.items?.[0]?.dataSet;
    const dataElement = firstItem?.elements?.['x54001010'];
    if (!firstItem || !dataElement) {
      return { channels: 0, samplesPerChannel: 0, samplingFrequency: '', channelLabels: [], samples: [] };
    }

    const channels = Math.max(1, this.getNumber(firstItem, 'x003a0005', 1));
    const samplingFrequency = this.getString(firstItem, 'x003a001a') || String(this.getNumber(firstItem, 'x003a001a', 0) || '');
    const interpretation = this.getString(firstItem, 'x54001006') || 'SS';
    const bitsAllocated = this.getNumber(firstItem, 'x54001004', 16);
    const bytesPerSample = Math.max(1, bitsAllocated / 8);
    const declaredSamples = this.getNumber(firstItem, 'x003a0010', 0);
    const samplesPerChannel = declaredSamples || Math.floor(dataElement.length / (channels * bytesPerSample));
    const bytes = firstItem.byteArray || dataSet.byteArray;
    const view = new DataView(bytes.buffer, bytes.byteOffset + dataElement.dataOffset, dataElement.length);
    const samples = Array.from({ length: channels }, () => [] as number[]);

    for (let sampleIndex = 0; sampleIndex < samplesPerChannel; sampleIndex++) {
      for (let channel = 0; channel < channels; channel++) {
        const offset = (sampleIndex * channels + channel) * bytesPerSample;
        if (offset + bytesPerSample > dataElement.length) {
          continue;
        }
        samples[channel].push(this.readWaveformValue(view, offset, bytesPerSample, interpretation));
      }
    }

    return {
      channels,
      samplesPerChannel,
      samplingFrequency,
      channelLabels: this.extractChannelLabels(firstItem),
      samples
    };
  }


  private isStructuredReport(dataSet: any): boolean {
    const modality = this.getString(dataSet, 'x00080060');
    const sopClassUid = this.getString(dataSet, 'x00080016');
    return modality === 'SR' ||
      sopClassUid.startsWith('1.2.840.10008.5.1.4.1.1.88') ||
      Boolean(dataSet.elements?.['x0040a730']);
  }

  private extractStructuredReport(dataSet: any): StructuredReportLine[] {
    const lines: StructuredReportLine[] = [];
    const title = this.getCodeMeaning(dataSet, 'x0040a043') ||
      this.getString(dataSet, 'x00420010') ||
      this.getString(dataSet, 'x00081030') ||
      'Structured Report';

    lines.push({ level: 0, label: title, value: this.getString(dataSet, 'x00080023') || this.getString(dataSet, 'x00080020') });
    this.walkContentSequence(dataSet, 1, lines);
    return lines.length > 1 ? lines : [{ level: 0, label: title, value: 'Sin contenido SR interpretable' }];
  }

  private walkContentSequence(dataSet: any, level: number, lines: StructuredReportLine[]): void {
    const sequence = dataSet.elements?.['x0040a730'];
    const items = sequence?.items || [];
    items.forEach((item: any) => {
      const itemDataSet = item.dataSet;
      if (!itemDataSet) {
        return;
      }

      const label = this.getCodeMeaning(itemDataSet, 'x0040a043') ||
        this.getCodeMeaning(itemDataSet, 'x0040a168') ||
        this.getString(itemDataSet, 'x0040a040') ||
        'Contenido';
      const value = this.getStructuredReportValue(itemDataSet);
      lines.push({ level: Math.min(level, 6), label, value });
      this.walkContentSequence(itemDataSet, level + 1, lines);
    });
  }

  private getStructuredReportValue(dataSet: any): string {
    const measured = this.getMeasuredValue(dataSet);
    return measured ||
      this.getString(dataSet, 'x0040a160') ||
      this.getString(dataSet, 'x0040a120') ||
      this.getString(dataSet, 'x0040a121') ||
      this.getString(dataSet, 'x0040a122') ||
      this.formatPersonName(this.getString(dataSet, 'x0040a123')) ||
      this.getString(dataSet, 'x0040a124') ||
      this.getCodeMeaning(dataSet, 'x0040a168') ||
      '';
  }

  private getMeasuredValue(dataSet: any): string {
    const sequence = dataSet.elements?.['x0040a300'];
    const measuredDataSet = sequence?.items?.[0]?.dataSet;
    if (!measuredDataSet) {
      return '';
    }

    const value = this.getString(measuredDataSet, 'x0040a30a');
    const unit = this.getCodeMeaning(measuredDataSet, 'x004008ea');
    return [value, unit].filter(Boolean).join(' ');
  }

  private getCodeMeaning(dataSet: any, sequenceTag: string): string {
    const sequence = dataSet.elements?.[sequenceTag];
    const firstItem = sequence?.items?.[0]?.dataSet;
    if (!firstItem) {
      return '';
    }
    return this.getString(firstItem, 'x00080104') ||
      this.getString(firstItem, 'x00080100') ||
      this.getString(firstItem, 'x00080102');
  }

  private hasWaveformData(dataSet: any): boolean {
    const sequence = dataSet.elements['x54000100'];
    const items = sequence?.items || [];
    return items.some((item: any) => Boolean(item.dataSet?.elements?.['x54001010']));
  }

  private getNumber(dataSet: any, tag: string, fallback = 0): number {
    try {
      const element = dataSet.elements?.[tag];
      if (!element) {
        return fallback;
      }
      if (element.vr === 'US') {
        return dataSet.uint16(tag) ?? fallback;
      }
      if (element.vr === 'SS') {
        return dataSet.int16(tag) ?? fallback;
      }
      if (element.vr === 'UL') {
        return dataSet.uint32(tag) ?? fallback;
      }
      if (element.vr === 'SL') {
        return dataSet.int32(tag) ?? fallback;
      }
      if (element.vr === 'DS' || element.vr === 'FL' || element.vr === 'FD') {
        return Number(dataSet.floatString?.(tag) ?? dataSet.string(tag) ?? fallback);
      }
      return Number(dataSet.string(tag) || fallback);
    } catch {
      return fallback;
    }
  }

  private readWaveformValue(view: DataView, offset: number, bytesPerSample: number, interpretation: string): number {
    if (bytesPerSample === 1) {
      return interpretation.startsWith('S') ? view.getInt8(offset) : view.getUint8(offset);
    }
    if (interpretation.startsWith('S')) {
      return view.getInt16(offset, true);
    }
    return view.getUint16(offset, true);
  }

  private extractChannelLabels(itemDataSet: any): string[] {
    const sequence = itemDataSet.elements['x003a0200'];
    if (!sequence?.items?.length) {
      return [];
    }
    return sequence.items.map((item: any, index: number) =>
      this.getString(item.dataSet, 'x003a0203') || this.defaultEcgLabels(sequence.items.length)[index] || `CH ${index + 1}`
    );
  }

  private drawEcgGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.fillStyle = '#fbf6f0';
    context.fillRect(0, 0, width, height);

    context.strokeStyle = 'rgba(227, 91, 84, 0.22)';
    context.lineWidth = 0.5;
    for (let x = 0; x < width; x += 8) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 8) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.strokeStyle = 'rgba(194, 61, 55, 0.38)';
    context.lineWidth = 0.8;
    for (let x = 0; x < width; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  private defaultEcgLabels(count: number): string[] {
    const labels = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
    return labels.slice(0, count);
  }

  private syncViewportInfo(): void {
    const viewport = cornerstone.getViewport(this.dicomViewport.nativeElement);
    this.zoom = Math.round((viewport.scale || 1) * 100);
    this.windowCenter = Math.round(viewport.voi?.windowCenter || 0);
    this.windowWidth = Math.round(viewport.voi?.windowWidth || 0);
  }

  private getString(dataSet: any, tag: string): string {
    try {
      return (dataSet.string(tag) || '').trim();
    } catch {
      return '';
    }
  }

  private formatTag(tag: string): string {
    return `(${tag.slice(1, 5).toUpperCase()},${tag.slice(5).toUpperCase()})`;
  }

  private formatPersonName(value: string): string {
    return value.replace(/\^/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private formatDicomDate(value: string): string {
    if (!/^\d{8}$/.test(value)) {
      return value;
    }
    return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  }
}

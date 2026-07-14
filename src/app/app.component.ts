import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import * as cornerstone from 'cornerstone-core';
import * as cornerstoneMath from 'cornerstone-math';
import * as cornerstoneTools from 'cornerstone-tools';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';
import * as dicomParser from 'dicom-parser';
import * as Hammer from 'hammerjs';
import * as JSZip from 'jszip';
import { environment } from '../environments/environment';

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

interface AiOpinionResponse {
  requestId: string;
  model: string;
  contentType: string;
  opinion: string;
  disclaimer: string;
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

  constructor(private sanitizer: DomSanitizer, private http: HttpClient) {}

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
  ecgLayout = '3x4+1';
  ecgRhythmLead = 'II';
  ecgLowCut = 0.05;
  ecgHighCut = 150;
  ecgSpeed = 25;
  ecgGain = 10;
  ecgComment = '';
  readonly ecgLayouts = ['3x4', '3x4+1', '3x4+3', '6x1-limb', '6x1-chest', '6x2', '6x2+1', '12x1'];
  readonly ecgLeads = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  readonly ecgLowCuts = [0.05, 0.5, 1];
  readonly ecgHighCuts = [40, 100, 150];
  readonly ecgSpeeds = [12.5, 25, 50];
  readonly ecgGains = [5, 10, 20];
  private readonly ecgComments = new Map<string, string>();
  renderError = '';
  safePdfUrl?: SafeResourceUrl;
  structuredReportLines: StructuredReportLine[] = [];
  isPlaying = false;
  showAboutDialog = false;
  showAiDialog = false;
  aiLoading = false;
  aiQuestion = 'Describe los hallazgos visibles, posibles explicaciones, limitaciones y grado de confianza.';
  aiOpinion?: AiOpinionResponse;
  aiError = '';
  aiPrivacyConfirmed = false;
  tagPanelWidth = 430;
  readonly studyPanelWidth = 344;
  resizingTagPanel = false;
  private playbackTimer?: ReturnType<typeof setInterval>;
  private readonly playbackDelay = 350;
  private readonly aiOpinionUrl = `${environment.aiApiBaseUrl}/ai/opinion`;

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
    this.expandedTreeKeys.clear();
    this.patientGroups.forEach(patient => {
      this.expandedTreeKeys.add(patient.key);
      patient.studies.forEach(study => this.expandedTreeKeys.add(study.key));
    });
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
      this.ecgComment = this.ecgComments.get(this.selected.id) || '';
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

  get canRequestAiOpinion(): boolean {
    return Boolean(this.selected && (this.viewerMode === 'image' || this.viewerMode === 'waveform') && !this.renderError);
  }

  openAiDialog(): void {
    if (!this.canRequestAiOpinion) {
      this.statusMessage = 'Selecciona una imagen o un electro renderizado';
      return;
    }
    this.aiOpinion = undefined;
    this.aiError = '';
    this.aiPrivacyConfirmed = false;
    this.showAiDialog = true;
  }

  closeAiDialog(): void {
    if (!this.aiLoading) this.showAiDialog = false;
  }

  async requestAiOpinion(): Promise<void> {
    if (!this.selected || !this.canRequestAiOpinion || this.aiLoading || !this.aiPrivacyConfirmed) return;
    this.aiLoading = true;
    this.aiError = '';
    this.aiOpinion = undefined;
    this.statusMessage = 'Preparando imagen anonimizada para la IA...';

    try {
      const canvas = this.getClinicalCanvas();
      const blob = await this.canvasToPng(canvas);
      const form = new FormData();
      form.append('image', blob, this.viewerMode === 'waveform' ? 'ecg-anonimizado.png' : 'imagen-anonimizada.png');
      form.append('contentType', this.viewerMode === 'waveform' ? 'ECG' : 'IMAGE');
      form.append('question', this.aiQuestion.trim());
      form.append('burnedInAnnotation', String(this.getString(this.selected.dataSet, 'x00280301').toUpperCase() === 'YES'));
      this.aiOpinion = await this.http.post<AiOpinionResponse>(this.aiOpinionUrl, form).toPromise();
      this.statusMessage = 'Opinión IA recibida para revisión profesional';
    } catch (error) {
      const httpError = error as HttpErrorResponse;
      this.aiError = httpError.error?.message || httpError.message || 'No se pudo obtener la opinión IA';
      this.statusMessage = this.aiError;
    } finally {
      this.aiLoading = false;
    }
  }

  private getClinicalCanvas(): HTMLCanvasElement {
    if (this.viewerMode === 'waveform') return this.ecgCanvas.nativeElement;
    const canvas = this.dicomViewport.nativeElement.querySelector('canvas');
    if (!canvas) throw new Error('No se encontró la imagen renderizada');
    return canvas;
  }

  private canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo preparar la imagen PNG')),
      'image/png'
    ));
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
    this.ecgComment = '';
    this.ecgComments.clear();
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

  clearImageAnnotations(): void {
    if (this.viewerMode !== 'image') return;
    const element = this.dicomViewport.nativeElement;
    ['Length', 'Probe'].forEach(toolName => cornerstoneTools.clearToolState(element, toolName));
    cornerstone.updateImage(element);
    this.statusMessage = 'Mediciones y marcas eliminadas de la imagen actual';
  }

  setActiveTool(toolName: string): void {
    if (this.viewerMode !== 'image') {
      this.statusMessage = 'Estas herramientas solo estan disponibles para imagenes DICOM';
      return;
    }

    const element = this.dicomViewport.nativeElement;
    const tools: any = cornerstoneTools;
    this.ensureCornerstoneEnabled(element);

    ['Wwwc', 'Pan', 'Zoom', 'Length', 'Probe'].forEach(name => {
      try {
        tools.setToolPassiveForElement(element, name);
      } catch {
        // A tool without state can already be passive.
      }
    });

    tools.setToolActiveForElement(element, toolName, { mouseButtonMask: 1 });
    if (toolName !== 'Pan') {
      tools.setToolActiveForElement(element, 'Pan', { mouseButtonMask: 2 });
    }
    try {
      tools.setToolActiveForElement(element, 'ZoomMouseWheel', {});
    } catch {
      // Mouse wheel support may not be available on every browser.
    }

    this.activeTool = toolName;
    const instructions: Record<string, string> = {
      Wwwc: 'WL activo: arrastra horizontal y verticalmente sobre la imagen',
      Pan: 'Pan activo: arrastra la imagen con el boton izquierdo',
      Zoom: 'Zoom activo: arrastra verticalmente o usa la rueda',
      Length: 'Medir activo: pulsa y arrastra entre dos puntos',
      Probe: 'Probe activo: pulsa sobre un pixel para consultar su valor'
    };
    this.statusMessage = instructions[toolName] || ('Herramienta activa: ' + toolName);
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
    tools.external.cornerstoneMath = cornerstoneMath;
    tools.external.Hammer = Hammer;
    tools.init({ showSVGCursors: true });

    [
      tools.WwwcTool,
      tools.PanTool,
      tools.ZoomTool,
      tools.ZoomMouseWheelTool,
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
    const tools: any = cornerstoneTools;
    [
      tools.WwwcTool,
      tools.PanTool,
      tools.ZoomTool,
      tools.ZoomMouseWheelTool,
      tools.LengthTool,
      tools.ProbeTool
    ].forEach((tool: any) => {
      if (!tool) return;
      try {
        tools.addToolForElement(element, tool);
      } catch {
        // Re-enabling the viewport may find a tool already registered.
      }
    });
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

  onEcgSettingChange(): void {
    if (this.viewerMode === 'waveform' && this.selected) {
      this.renderWaveform(this.selected);
    }
  }

  onEcgCommentChange(): void {
    if (this.selected) {
      this.ecgComments.set(this.selected.id, this.ecgComment);
    }
  }

  get ecgHeader(): { dateTime: string; accession: string; rate: string; pr: string; qrs: string; qt: string; axes: string; bp: string } {
    const dataSet = this.selected?.dataSet;
    if (!dataSet) {
      return { dateTime: '-', accession: '-', rate: '-', pr: '-', qrs: '-', qt: '-', axes: '-', bp: '-' };
    }
    const date = this.formatDicomDate(this.getString(dataSet, 'x00080023') || this.getString(dataSet, 'x00080020'));
    const rawTime = this.getString(dataSet, 'x00080033') || this.getString(dataSet, 'x00080030');
    const time = rawTime ? [rawTime.slice(0, 2), rawTime.slice(2, 4), rawTime.slice(4, 6)].filter(Boolean).join(':') : '';
    const qt = this.findEcgMeasurement(dataSet, ['qt interval', 'qt duration', 'qt time period']);
    const qtc = this.findEcgMeasurement(dataSet, ['qtc interval', 'corrected qt', 'qtc duration']);
    const pAxis = this.findEcgMeasurement(dataSet, ['p axis', 'p-wave axis', 'p wave axis']);
    const rAxis = this.findEcgMeasurement(dataSet, ['r axis', 'qrs axis', 'qrs mean axis']);
    const tAxis = this.findEcgMeasurement(dataSet, ['t axis', 't-wave axis', 't wave axis']);
    const systolic = this.findEcgMeasurement(dataSet, ['systolic blood pressure']);
    const diastolic = this.findEcgMeasurement(dataSet, ['diastolic blood pressure']);
    return {
      dateTime: [date, time].filter(Boolean).join(' ') || '-',
      accession: this.getString(dataSet, 'x00080050') || '-',
      rate: this.getString(dataSet, 'x00181088') || this.findEcgMeasurement(dataSet, ['ventricular heart rate', 'ventricular rate', 'heart rate']) || '-',
      pr: this.findEcgMeasurement(dataSet, ['pr interval global', 'pr interval', 'p-r interval', 'pr time period']) || '-',
      qrs: this.findEcgMeasurement(dataSet, ['qrs duration global', 'qrs duration', 'qrs time period']) || '-',
      qt: this.joinEcgMeasurements(qt, qtc) || this.findEcgMeasurement(dataSet, ['qt/qtc']) || '-',
      axes: this.joinEcgMeasurements(pAxis, rAxis, tAxis) || this.findEcgMeasurement(dataSet, ['p/r/t axes']) || '-',
      bp: this.joinEcgMeasurements(systolic, diastolic) || this.findEcgMeasurement(dataSet, ['blood pressure']) || '-'
    };
  }

  private renderWaveform(instance: DicomInstance): void {
    const canvas = this.ecgCanvas.nativeElement;
    const context = canvas.getContext('2d');
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(760, Math.floor(rect.width * dpr));
    canvas.height = Math.max(420, Math.floor(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    this.drawEcgGrid(context, width, height);
    const waveform = this.extractWaveform(instance.dataSet);
    if (!waveform.samples.length) {
      context.fillStyle = '#263039';
      context.font = '16px Segoe UI';
      context.fillText('No se pudo extraer WaveformData de este ECG.', 28, 46);
      this.ecgInfo = 'Waveform no disponible';
      return;
    }

    const labels = waveform.channelLabels.length ? waveform.channelLabels : this.defaultEcgLabels(waveform.channels);
    const samplingFrequency = Number(waveform.samplingFrequency) || 500;
    const filtered = waveform.samples.map(values => this.filterEcgSignal(values, samplingFrequency));
    const panels = this.buildEcgPanels(labels);
    const rows = Math.max(...panels.map(panel => panel.row)) + 1;
    const columns = Math.max(...panels.map(panel => panel.column)) + 1;
    const rowHeight = height / rows;
    const columnWidth = width / columns;
    const speedFactor = 25 / this.ecgSpeed;
    const requestedSamples = Math.max(80, Math.floor(waveform.samplesPerChannel * speedFactor));
    const globalPeak = Math.max(1, ...filtered.flatMap(values => values.slice(0, requestedSamples).map(value => Math.abs(value))));

    context.strokeStyle = '#14191d';
    context.fillStyle = '#20272c';
    context.font = '12px Segoe UI';
    context.lineWidth = 1.25;

    panels.forEach(panel => {
      const values = filtered[panel.channel] || [];
      const left = panel.column * columnWidth + 34;
      const right = (panel.column + panel.columnSpan) * columnWidth - 12;
      const top = panel.row * rowHeight;
      const mid = top + rowHeight / 2;
      const count = Math.min(values.length, requestedSamples);
      const scale = (rowHeight * 0.34 / globalPeak) * (this.ecgGain / 10);

      context.fillText(panel.label, panel.column * columnWidth + 8, top + 18);
      context.beginPath();
      for (let index = 0; index < count; index++) {
        const x = left + (index / Math.max(1, count - 1)) * (right - left);
        const y = mid - values[index] * scale;
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      }
      context.stroke();
    });

    this.ecgInfo = `${waveform.channels} canales | ${waveform.samplesPerChannel} muestras | ${waveform.samplingFrequency || '?'} Hz`;
  }

  private buildEcgPanels(labels: string[]): Array<{ channel: number; label: string; row: number; column: number; columnSpan: number }> {
    const channelFor = (lead: string, fallback: number) => {
      const index = labels.findIndex(label => label.toUpperCase() === lead.toUpperCase());
      return index >= 0 ? index : Math.min(fallback, labels.length - 1);
    };
    const panel = (channel: number, row: number, column: number, columnSpan = 1) => ({
      channel,
      label: labels[channel] || `CH ${channel + 1}`,
      row,
      column,
      columnSpan
    });
    const all = labels.slice(0, 12);
    const rhythm = channelFor(this.ecgRhythmLead, 1);

    if (this.ecgLayout === '12x1') return all.map((_, index) => panel(index, index, 0));
    if (this.ecgLayout === '6x1-limb') return all.slice(0, 6).map((_, index) => panel(index, index, 0));
    if (this.ecgLayout === '6x1-chest') return all.slice(6, 12).map((_, index) => panel(index + 6, index, 0));
    if (this.ecgLayout === '6x2' || this.ecgLayout === '6x2+1') {
      const result = all.map((_, index) => panel(index, index % 6, Math.floor(index / 6)));
      if (this.ecgLayout.endsWith('+1')) result.push(panel(rhythm, 6, 0, 2));
      return result;
    }

    const standardOrder = ['I', 'aVR', 'V1', 'V4', 'II', 'aVL', 'V2', 'V5', 'III', 'aVF', 'V3', 'V6'];
    const result = standardOrder.map((lead, index) => panel(channelFor(lead, index), index % 3, Math.floor(index / 3)));
    if (this.ecgLayout === '3x4+1') result.push(panel(rhythm, 3, 0, 4));
    if (this.ecgLayout === '3x4+3') ['II', 'V1', 'V5'].forEach((lead, index) => result.push(panel(channelFor(lead, index), 3 + index, 0, 4)));
    return result;
  }

  private filterEcgSignal(values: number[], samplingFrequency: number): number[] {
    let output = values.slice();
    if (this.ecgHighCut > 0 && this.ecgHighCut < samplingFrequency / 2) {
      const alpha = 1 - Math.exp(-2 * Math.PI * this.ecgHighCut / samplingFrequency);
      let previous = output[0] || 0;
      output = output.map(value => (previous += alpha * (value - previous)));
    }
    if (this.ecgLowCut > 0) {
      const rc = 1 / (2 * Math.PI * this.ecgLowCut);
      const dt = 1 / samplingFrequency;
      const alpha = rc / (rc + dt);
      let previousInput = output[0] || 0;
      let previousOutput = 0;
      output = output.map(value => {
        previousOutput = alpha * (previousOutput + value - previousInput);
        previousInput = value;
        return previousOutput;
      });
    }
    return output;
  }

  private joinEcgMeasurements(...values: string[]): string {
    const populated = values.filter(Boolean);
    if (!populated.length) return '';
    const unit = populated.map(value => value.match(/(?:bpm|ms|mm hg|deg|°)$/i)?.[0]).find(Boolean) || '';
    const clean = populated.map(value => value.replace(/\s*(?:bpm|ms|mm hg|deg|°)$/i, '').trim());
    return clean.join('/') + (unit ? ' ' + unit : '');
  }

  private findEcgMeasurement(dataSet: any, names: string[]): string {
    const wanted = names.map(name => name.toLowerCase());
    const textValue = (current: any): string => {
      const numeric = this.getString(current, 'x0040a30a');
      const unit = this.getCodeMeaning(current, 'x004008ea');
      if (numeric) return [numeric, unit].filter(Boolean).join(' ');
      return this.getString(current, 'x0040a160') || this.getString(current, 'x00700006');
    };
    const extractFromText = (text: string): string => {
      if (!text) return '';
      const normalized = text.replace(/\r/g, '\n');
      for (const line of normalized.split(/\n|;/)) {
        const lower = line.toLowerCase();
        if (!wanted.some(name => lower.includes(name))) continue;
        const separator = line.search(/[:=]/);
        if (separator >= 0) return line.slice(separator + 1).trim();
        const measurement = line.match(/[-+]?\d+(?:\.\d+)?(?:\s*\/\s*[-+]?\d+(?:\.\d+)?){0,2}\s*(?:bpm|ms|mm\s*hg|deg|°)?/i);
        if (measurement) return measurement[0].trim();
      }
      return '';
    };
    const visit = (current: any, depth: number): string => {
      if (!current || depth > 8) return '';
      const meaning = this.getCodeMeaning(current, 'x0040a043').toLowerCase();
      if (meaning && wanted.some(name => meaning.includes(name))) {
        const value = textValue(current);
        if (value) return value;
      }
      const inline = extractFromText(this.getString(current, 'x00700006') || this.getString(current, 'x0040a160'));
      if (inline) return inline;
      for (const element of Object.values(current.elements || {}) as any[]) {
        for (const item of element?.items || []) {
          const found = visit(item.dataSet, depth + 1);
          if (found) return found;
        }
      }
      return '';
    };
    return visit(dataSet, 0);
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

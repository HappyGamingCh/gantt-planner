import { describe, expect, it } from 'vitest';
import { sampleBytes } from '../../scripts/fixtures';
import { listText, scanFile } from '../../src/excel/unsupported';
import { patchZip } from './zip';

const zipNames = (...names: string[]) => new TextEncoder().encode(names.map((n) => `PK\u0003\u0004....${n}....`).join(''));
const unsupported = async (bytes: Uint8Array) => (await scanFile(bytes)).unsupported;

// The sample's Tasks sheet is sheet2.xml (Project is sheet1).
const TASKS = 'xl/worksheets/sheet2.xml';
const beforeEnd = (tag: string, xml: string) => (s: string) => s.replace(`</${tag}>`, `${xml}</${tag}>`);

describe('content ExcelJS would drop — SPEC §3.5', () => {
  it('is found by part name', async () => {
    expect(await unsupported(zipNames('xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/media/image1.png'))).toEqual([]);
    expect(await unsupported(zipNames('xl/charts/chart1.xml', 'xl/chartsheets/sheet1.xml', 'xl/pivotTables/pivotTable1.xml'))).toEqual([
      'charts',
      'pivot tables',
    ]);
    expect(await unsupported(zipNames('xl/threadedComments/threadedComment1.xml', 'xl/ctrlProps/ctrlProp1.xml', 'xl/activeX/activeX1.xml'))).toEqual([
      'threaded comments',
      'form controls',
    ]);
    expect(await unsupported(zipNames('xl/externalLinks/externalLink1.xml', 'xl/connections.xml', 'docMetadata/LabelInfo.xml'))).toEqual([
      'links to other workbooks',
      'data connections',
      'a sensitivity label',
    ]);
    expect(await unsupported(zipNames('xl/richData/rdrichvalue.xml', 'xl/embeddings/oleObject1.bin'))).toEqual([
      'pictures in cells and data types',
      'embedded objects',
    ]);
  });

  it('finds nothing in the sample, and never throws on a file it can’t read', async () => {
    expect(await scanFile(await sampleBytes())).toEqual({ unsupported: [], filtered: [] });
    expect(await scanFile(new Uint8Array([80, 75, 5, 6, 1, 2, 3]))).toEqual({ unsupported: [], filtered: [] });
  });

  it('looks inside compressed parts: shapes, cross-sheet drop-downs, sparklines, internal links, sensitivity labels', async () => {
    const bytes = patchZip(await sampleBytes(), {
      'xl/drawings/drawing1.xml': () => '<xdr:wsDr><xdr:twoCellAnchor><xdr:sp macro=""><xdr:txBody/></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>',
      [TASKS]: beforeEnd(
        'worksheet',
        '<hyperlinks><hyperlink ref="R3" location="\'Read Me\'!A1" display="See read me"/></hyperlinks>' +
          '<extLst><ext uri="{CCE6A557-97BC-4b89-ADB6-D9C93CAAB3DF}"><x14:dataValidations count="1"><x14:dataValidation type="list" allowBlank="1">' +
          '<x14:formula1><xm:f>Resources!$A$2:$A$50</xm:f></x14:formula1><xm:sqref>C2:C200</xm:sqref></x14:dataValidation></x14:dataValidations></ext>' +
          '<ext uri="{05C60535-1F16-4fd2-B633-F4F36F0B64E0}"><x14:sparklineGroups><x14:sparklineGroup/></x14:sparklineGroups></ext></extLst>',
      ),
      'docProps/custom.xml': () => '<Properties><property name="MSIP_Label_1234_Enabled"><vt:lpwstr>true</vt:lpwstr></property></Properties>',
    });
    expect(await unsupported(bytes)).toEqual([
      'text boxes and shapes',
      'drop-down lists that use another sheet',
      'sparklines',
      'links to places in this workbook',
      'a sensitivity label',
    ]);
  });

  it('keeps quiet about what ExcelJS keeps: pictures, web links, SharePoint properties', async () => {
    const bytes = patchZip(await sampleBytes(), {
      'xl/drawings/drawing1.xml': () => '<xdr:wsDr><xdr:twoCellAnchor><xdr:pic><xdr:spPr/></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>',
      [TASKS]: beforeEnd('worksheet', '<hyperlinks><hyperlink ref="R3" r:id="rId9"/></hyperlinks>'),
      'docProps/custom.xml': () => '<Properties><property name="ContentTypeId"><vt:lpwstr>0x0101</vt:lpwstr></property></Properties>',
    });
    expect(await unsupported(bytes)).toEqual([]);
  });

  it('names the defined names Save would drop or change, not plain ranges or Excel’s own', async () => {
    const names = [
      '<definedName name="ResList">OFFSET(Resources!$A$2,0,0,COUNTA(Resources!$A:$A)-1,1)</definedName>',
      '<definedName name="VatRate">0.07</definedName>',
      '<definedName name="AllAssigned">Tasks!$C:$C</definedName>',
      '<definedName name="LocalStart" localSheetId="1">Tasks!$D$2</definedName>',
      '<definedName name="PlainRange">Resources!$A$2:$A$20</definedName>',
      '<definedName name="Quoted">&apos;Read Me&apos;!$A$1,&apos;Read Me&apos;!$A$3</definedName>',
      '<definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">Tasks!$A$1:$S$26</definedName>',
      '<definedName name="_xlnm.Print_Area" localSheetId="1">Tasks!$A$1:$R$26</definedName>',
      '<definedName name="Broken">#REF!</definedName>',
    ];
    const bytes = patchZip(await sampleBytes(), {
      'xl/workbook.xml': (xml) => xml.replace('</sheets>', `</sheets><definedNames>${names.join('')}</definedNames>`),
    });
    expect(await unsupported(bytes)).toEqual(['named ranges (ResList, VatRate, AllAssigned, …)']);
  });

  it('reads stored (uncompressed) parts and absolute relationship targets too', async () => {
    const bytes = patchZip(
      await sampleBytes(),
      {
        'xl/_rels/workbook.xml.rels': (xml) => xml.replace('Target="worksheets/sheet2.xml"', 'Target="/xl/worksheets/sheet2.xml"'),
        [TASKS]: beforeEnd('worksheet', '<extLst><ext><x14:sparklineGroups><x14:sparklineGroup/></x14:sparklineGroups></ext></extLst>'),
      },
      true,
    );
    expect(await unsupported(bytes)).toEqual(['sparklines']);
  });

  it('finds ISO date cells (t="d"), which ExcelJS reads as their year', async () => {
    const bytes = patchZip(await sampleBytes(), {
      [TASKS]: beforeEnd('sheetData', '<row r="300"><c r="E300" s="1" t="d"><v>2026-10-30</v></c></row>'),
    });
    expect(await unsupported(bytes)).toEqual(['date cells in ISO format (written by another program)']);
  });

  it('finds the sheets Excel saved with a filter applied', async () => {
    const filtered = patchZip(await sampleBytes(), {
      [TASKS]: (xml) => xml.replace(/<autoFilter ref="([^"]+)"\/>/, '<autoFilter ref="$1"><filterColumn colId="2"><filters><filter val="ACME"/></filters></filterColumn></autoFilter>'),
    });
    expect(await scanFile(filtered)).toEqual({ unsupported: [], filtered: ['Tasks'] });
    // Save shows the rows a filter hid on Tasks; on another sheet they stay hidden, so the first Save asks.
    const flagged = patchZip(await sampleBytes(), { 'xl/worksheets/sheet3.xml': (xml) => xml.replace('<dimension', '<sheetPr filterMode="1"/><dimension') });
    expect(await scanFile(flagged)).toEqual({ unsupported: ['the filter on sheet "Resources" (rows it hid stay hidden)'], filtered: ['Resources'] });
  });

  it('finds a filter kept in an Excel table part, where Excel writes it for a filtered table', async () => {
    const withTable = async (autoFilter: string, target = '../tables/table1.xml') =>
      patchZip(await sampleBytes(), {
        [TASKS]: (xml) => xml.replace('</worksheet>', '<tableParts count="1"><tablePart r:id="rId9"/></tableParts></worksheet>'),
        'xl/worksheets/_rels/sheet2.xml.rels': (xml) =>
          xml.replace('</Relationships>', `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="${target}"/></Relationships>`),
        'xl/tables/table1.xml': () =>
          '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="TaskTable" displayName="TaskTable" ref="A1:S26">' +
          `${autoFilter}<tableColumns count="1"><tableColumn id="1" name="ID"/></tableColumns></table>`,
      });
    const criteria = '<autoFilter ref="A1:S26"><filterColumn colId="2"><filters><filter val="ACME"/></filters></filterColumn></autoFilter>';
    expect(await scanFile(await withTable('<autoFilter ref="A1:S26"/>'))).toEqual({ unsupported: [], filtered: [] });
    expect(await scanFile(await withTable(criteria))).toEqual({ unsupported: [], filtered: ['Tasks'] });
    expect((await scanFile(await withTable(criteria, '/xl/tables/table1.xml'))).filtered).toEqual(['Tasks']); // a target from the root
  });

  it('is listed in plain English', () => {
    expect(listText(['charts'])).toBe('charts');
    expect(listText(['charts', 'slicers'])).toBe('charts and slicers');
    expect(listText(['charts', 'slicers', 'timelines'])).toBe('charts, slicers and timelines');
  });
});

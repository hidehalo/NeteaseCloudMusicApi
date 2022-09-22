import { TransformFunction, TransformableInfo } from 'logform';

// TODO: 实现源码文件追溯
const fileTrace: TransformFunction = (info: TransformableInfo, opts?: any): TransformableInfo | boolean =>  {
  var fileName = ''
  var rowNumber
  var columnNumber
  // this is the value representing the position of your caller in the error stack.
  var currentStackPosition = 1;
  let e: any;
  try {
    e = new Error('Custom Error');
    throw e;
  } catch (_) {
    Error['prepareStackTrace'] = function () {
      return arguments[1]
    }
    Error.prepareStackTrace(e, [] as NodeJS.CallSite[])
    fileName = e.stack[currentStackPosition].getFileName()
    rowNumber = e.stack[currentStackPosition].getLineNumber()
    columnNumber = e.stack[currentStackPosition].getColumnNumber()
  }
  return { level:'info', message: `${fileName}:${rowNumber}:${columnNumber}` }
}

export {
  fileTrace
}

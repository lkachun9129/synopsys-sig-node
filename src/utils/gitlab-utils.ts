import { Gitlab } from '@gitbeaker/node'
import { Types } from '@gitbeaker/core'
import { ProjectSchema } from '@gitbeaker/core/dist/types/resources/Projects'
import { BaseRequestOptions } from '@gitbeaker/core/dist/types/types'
import { CommitDiffSchema } from '@gitbeaker/core/dist/types/resources/Commits'
import { DiscussionNotePosition } from '@gitbeaker/core/dist/types/templates/ResourceDiscussions'
import { DiscussionSchema } from '@gitbeaker/core/dist/types/templates/ResourceDiscussions'

import { logger } from "./SIGLogger"
import axios from "axios"

export async function getProject(gitlab_url: string, gitlab_token: string, project_id: string): Promise<ProjectSchema> {
    const api = new Gitlab({ token: gitlab_token })

    logger.debug(`Getting project ${project_id}`)

    let project = await api.Projects.show(project_id)

    logger.debug(`Project name is ${project.name}`)

    return project
}

export async function getDiscussions(gitlab_url: string, gitlab_token: string, project_id: string, merge_request_iid: number): Promise<DiscussionSchema[]> {
    const api = new Gitlab({ token: gitlab_token })

    logger.debug(`Getting merge request #${merge_request_iid} in project #${project_id}`)
    let merge_request = await api.MergeRequests.show(project_id, merge_request_iid)
    logger.debug(`Merge Request title is ${merge_request.title}`)

    let discussions = await api.MergeRequestDiscussions.all(project_id, merge_request_iid)
    for (const discussion of discussions) {
        logger.debug(`Discussion ${discussion.id}`)
        if (discussion.notes) {
            for (const note of discussion.notes) {
                logger.debug(`  body=${note.body}`)
                logger.debug(`  base_sha=${note.position?.base_sha} head_sha=${note.position?.head_sha} start_sha=${note.position?.start_sha}`)
                logger.debug(`  position_type=${note.position?.position_type} new_path=${note.position?.new_path} old_path=${note.position?.old_path}`)
                logger.debug(`  new_line=${note.position?.new_line}`)
            }
        }
    }

    return discussions
}

export async function getDiffMap(gitlab_url: string, gitlab_token: string, project_id: string, merge_request_iid: number): Promise<Map<any, any>> {
    const api = new Gitlab({ token: gitlab_token })

    logger.debug(`Getting commits for merge request #${merge_request_iid} in project #${project_id}`)
    let commits = await api.MergeRequests.commits(project_id, merge_request_iid)

    const diffMap = new Map()

    for (const commit of commits) {
        logger.debug(`Commit #${commit.id}: ${commit.title}`)
        let diffs = await api.Commits.diff(project_id, commit.id)
        for (const diff of diffs) {
            logger.debug(`  Diff file: ${diff.new_path} diff: ${diff.diff}`)

            const path = diff.new_path
            diffMap.set(path, [])

            const diff_text = diff.diff
            if (diff_text.startsWith('@@')) {
                let changedLines = diff_text.substring(3)
                changedLines = changedLines.substring(0, changedLines.indexOf(' @@'))

                const linesAddedPosition = changedLines.indexOf('+')
                if (linesAddedPosition > -1) {
                    // We only care about the right side because SI can only analyze what's there, not what used to be
                    const linesAddedString = changedLines.substring(linesAddedPosition + 1)
                    const separatorPosition = linesAddedString.indexOf(',')

                    const startLine = parseInt(linesAddedString.substring(0, separatorPosition))
                    const lineCount = parseInt(linesAddedString.substring(separatorPosition + 1))
                    const endLine = startLine + lineCount - 1

                    if (!diffMap.has(path)) {
                        diffMap.set(path, [])
                    }
                    logger.debug(`Added ${path}: ${startLine} to ${endLine}`)
                    diffMap.get(path)?.push({firstLine: startLine, lastLine: endLine, sha: commit.id})
                }
            }
        }
    }

    return diffMap
}

export async function updateNote(gitlab_url: string, gitlab_token: string, project_id: string, merge_request_iid: number,
                                       discussion_id: number, note_id: number, body: string): Promise<boolean> {
    const api = new Gitlab({ token: gitlab_token })

    logger.debug(`Update discussion for merge request #${merge_request_iid} in project #${project_id}`)

    let note = await api.MergeRequestDiscussions.editNote(project_id, merge_request_iid, discussion_id, note_id,
        { body: body })

    return true
}
export async function createDiscussion(gitlab_url: string, gitlab_token: string, project_id: string, merge_request_iid: number,
                                       line: number, filename: string, body: string, base_sha: string): Promise<boolean> {
    const api = new Gitlab({ token: gitlab_token })

    logger.debug(`Create new discussion for merge request #${merge_request_iid} in project #${project_id}`)

    let merge_request = await api.MergeRequests.show(project_id, merge_request_iid)

    // JC: GitBeaker isn't working for this case (filed https://github.com/jdalrymple/gitbeaker/issues/2396)
    // Working around using bare REST query

    const FormData = require('form-data');
    const formData = new FormData();
    formData.append("body", body)
    formData.append("position[position_type]", "text")
    formData.append("position[base_sha]", base_sha)
    formData.append("position[start_sha]", base_sha)
    formData.append("position[head_sha]", merge_request.sha)
    formData.append("position[new_path]", filename)
    formData.append("position[old_path]", filename)
    formData.append("position[new_line]", line.toString())

    let headers = {
        "PRIVATE-TOKEN": gitlab_token,
        'content-type': `multipart/form-data; boundary=${formData._boundary}`
    }

    let url = `${gitlab_url}/api/v4/projects/${project_id}/merge_requests/${merge_request_iid}/discussions`

    const res = await axios.post(url,
        formData, {
            headers: headers
        })

    if (res.status > 201) {
        logger.error(`Unable to create discussion for ${filename}:${line} at ${url}`)
        return false
    }

    return true
}

export type DiffMap = Map<string, Hunk[]>

export interface Hunk {
    firstLine: number
    lastLine: number
    sha: string
}